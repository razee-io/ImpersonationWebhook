/**
 * Copyright 2022 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const express = require('express');
const { KubeClass } = require('@razee/kubernetes-util');
const kubeApiConfig = new KubeClass();
const https = require('https');
const objectPath = require('object-path');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const fs = require('fs-extra');
const appName = 'ImpersonationWebhook';
const log = require('./logger').createLogger(appName);

https.globalAgent.options.ca = [kubeApiConfig.ca];

const app = express();
app.use(bodyParser.json());
const port = 8443;

const options = {
  ca: process.env.TLS_CA,
  cert: process.env.TLS_CERT,
  key: process.env.TLS_KEY,
};

async function impersonation_enabled() {
  let enableImpersonation = 'false';
  let enableImpersonationPath = './config/enable-impersonation';
  let exists = await fs.pathExists(enableImpersonationPath);
  if (exists) {
    enableImpersonation = await fs.readFile(enableImpersonationPath, 'utf8');
    enableImpersonation = enableImpersonation.trim().toLowerCase();
  }
  return (enableImpersonation == 'true');
}

async function checkUserPermission(namespace, username, resource, action) {
  const body = {};
  objectPath.set(body, 'apiVersion', 'authorization.k8s.io/v1');
  objectPath.set(body, 'kind', 'SubjectAccessReview');
  objectPath.set(body, 'spec.resourceAttributes.resource', resource);
  objectPath.set(body, 'spec.resourceAttributes.verb', action);
  objectPath.set(body, 'spec.resourceAttributes.namespace', namespace);
  objectPath.set(body, 'spec.user', username);

  let allowed = false;

  await fetch(`${kubeApiConfig.baseUrl}/apis/authorization.k8s.io/v1/subjectaccessreviews`, {
    method: 'post',
    body: JSON.stringify(body),
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': objectPath.get(kubeApiConfig, 'headers.Authorization'),
      'User-Agent': objectPath.get(kubeApiConfig, 'headers.User-Agent')
    }
  })
    .then((res) => { if (res.ok) { return res.json(); } else { throw new Error(res.json()); } })
    .then(json => { allowed = json.status.allowed ? true : false; })
    .catch((err) => { throw err; });

  return allowed;
}

function createJSONPatch(op, path, value) {
  let patch = {};
  patch.op = op;
  patch.path = path;
  patch.value = value;
  return Buffer.from(JSON.stringify([patch])).toString('base64');
}

async function processRequest(request) {
  let reviewResponse = {};
  objectPath.set(reviewResponse, 'apiVersion', 'admission.k8s.io/v1');
  objectPath.set(reviewResponse, 'kind', 'AdmissionReview');
  objectPath.set(reviewResponse, 'response.uid', request.uid);

  if (!(await impersonation_enabled())) {
    objectPath.set(reviewResponse, 'response.allowed', true);
    return reviewResponse;
  }

  const authenticatedUser = request.userInfo.username;
  const object = request.object;
  let allowed = true;
  let changed = false;

  let impersonateUser = '';

  if (objectPath.has(object, 'spec.clusterAuth.impersonateUser')) {
    impersonateUser = objectPath.get(object, 'spec.clusterAuth.impersonateUser');
  }

  if (impersonateUser && impersonateUser != authenticatedUser) {
    try {
      let userCanImpersonate = await checkUserPermission(request.namespace, authenticatedUser, 'users', 'impersonate');
      if (!userCanImpersonate) {
        log.debug(`${authenticatedUser} doesn't have impersonate permission.`);
        impersonateUser = authenticatedUser;
        changed = true;
      }
    } catch (error) {
      log.error(error);
      allowed = false;
    }
  }
  else {
    if (impersonateUser === '') {
      changed = true;
      impersonateUser = authenticatedUser;
    }
    else {
      changed = false;
    }
  }

  objectPath.set(reviewResponse, 'response.allowed', allowed);

  if (allowed) {
    if (changed) {
      objectPath.set(reviewResponse, 'response.patchType', 'JSONPatch');
      objectPath.set(request.object.spec, 'clusterAuth.impersonateUser', impersonateUser);
      let patch = createJSONPatch('add', '/spec', request.object.spec);
      objectPath.set(reviewResponse, 'response.patch', patch);
    }
  }
  else {
    log.error('Was unable to validate if authenticated user can impersonate others.');
    objectPath.set(reviewResponse, 'response.status.message', 'Was unable to validate if authenticated user can impersonate others.');
  }

  return reviewResponse;
}

async function main() {
  app.post('/validate', async (req, res) => {
    if (req.body.request === undefined || req.body.request.uid === undefined) {
      res.status(400).send();
    }
    else {
      res.status(200).send(await processRequest(req.body.request));
    }
  });

  app.get('/readyz', (req, res) => res.status(200).json({ status: 'ok' }).send());
  app.get('/livez', (req, res) => res.status(200).json({ status: 'ok' }).send());

  https.createServer(options, app).listen(port, () => {
    log.info(`${appName} is running on ${port}`);
  });
}

function createEventListeners() {
  process.on('SIGTERM', () => {
    log.info('recieved SIGTERM. not handling at this time.');
  });
  process.on('unhandledRejection', (reason) => {
    log.error('received unhandledRejection.', reason);
  });
  process.on('beforeExit', (code) => {
    log.info(`No work found. exiting with code: ${code}`);
  });
}

async function run() {
  try {
    createEventListeners();
    await main();
  } catch (error) {
    log.error(error);
  }
}

module.exports = {
  run
};
