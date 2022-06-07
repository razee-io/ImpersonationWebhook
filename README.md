# Impersonation Webhook

This admission webhook supports impersonation feature
provided by Razee controllers by intercepting requests
that create razee resources
(such as [RemoteResource](https://github.com/razee-io/RemoteResource) and
[MustacheTemplate](https://github.com/razee-io/MustacheTemplate)) and
updates the `spec.clusterAuth.impersonateUser` field accordingly based
on the following rules:

| | `impersonateUser` set | `impersonateUser` **not** set |
| ---| --- | --- |
|**The authenticated can impersonate**|not changed|authenticated user|
|**The authenticated cannot impersonate**|authenticated user|authenticated user|

**Note**: "user" implies normal users or service accounts, whichever applicable.

The webhook relies on the `authorization.k8s.io` API group, specifically
`SubjectAccessReview` API, to determine the authenticated user's permission.
Refer to [Role-based access control](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
and [checking-api-access](https://kubernetes.io/docs/reference/access-authn-authz/authorization/#checking-api-access)
for more information.

Since this webhook has already performed the validation, downstream razee
controllers will respect `clusterAuth.impersonateUser` value and impersonate
the specified user.

## Installation

Communication between admission controllers and webhooks is via HTTPS:

- Webhook servers must present a valid certificate. The certificate and key are
  stored in a secret.
- Admission controllers will validate the presented certificate by using the
  certificate authority set in `caBundle` field in `MutatingWebhookConfiguration`.

It's up to the user to create and manage the certificate, key, certificate
authority, and rotation strategy.

For your reference, a self-signed certificate can be quickly created with the
following command for demo purpose:

```bash
openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes -keyout server.key 
-out server.crt -subj "/CN=impersonation-webhook.default.svc" 
-addext "subjectAltName=DNS:impersonation-webhook.default.svc"
```

Note: Output `server.crt` file can be used as certificate authority and server
certificate. The `default` namespace is used in `DNS`, and it should be updated
accordingly if the webhook is deployed in a different namespace.

1. Create secret named `impersonation` holding certificate information.

   ```yaml
    apiVersion: v1
    kind: Secret
    metadata:
      name: impersonation
    type: kubernetes.io/tls
    data:
      ca.crt: "certificate authority base-64 encoded"
      tls.crt: "server certificate base-64 encoded"
      tls.key: "server secret base-64 encoded"
   ```

2. Deploy the webhook.

   **Note**: Like other razee controllers, this webhook needs the service
   account, roles, and role bindings created by
   [razeedeploy-delta](https://github.com/razee-io/razeedeploy-delta),
   so they must be created first.

   ```bash
   kubectlapply -f "https://github.com/razee-io/ImpersonationWebhook/releases/latest/download/resource.yaml"
   ```

3. Create MutatingWebhookConfiguration.

   Add certificate authority to `caBundle` field.

   ```yaml
    apiVersion: admissionregistration.k8s.io/v1
    kind: MutatingWebhookConfiguration
    metadata:
      name: impersonation-webhook
    webhooks:
    - name: impersonation-webhook
      rules:
      - apiGroups:   ["deploy.razee.io"]
        apiVersions: ["v1alpha2"]
        operations:  ["CREATE", "UPDATE"]
        resources:   ["mustachetemplates", "remoteresources"]
      clientConfig:
        service:
          name: impersonation-webhook
          path: "/validate"
        caBundle: "certificate authority base-64 encoded"
      admissionReviewVersions: ["v1"]
      sideEffects: None
      timeoutSeconds: 10
   ```

## Impersonation with Nested Resources

It is possible to have a deployment with multiple nested resources like this:

``` yaml
RemoteResource 1:
  - impersonate user: B
  - download: RemoteResource 2
```

``` yaml
RemoteResource 2:
  - impersonate user: C
  - download: A K8 deployment
```

Assume A creates `RemoteResource 1`. If A has impersonation permission,
`RemoteResource 2` will be created under the name of user B (it's equivalent to
that B creates `RemoteResource 2`). Otherwise, it will be created under the name
of user A.

Assume A has impersonation permission, `RemoteResource 2` will be created under
the name of user B. Recursively, if B has impersonation permission, the
`K8 deployment` will be created under the name of user C. Otherwise, it will be
created under the name of B.

In this case, users should be aware of this impersonation process and make sure
that necessary role bindings are created to achieve desired outcome. The webhook
relies on the `authorization.k8s.io` API group, specifically
`SubjectAccessReview` API, to determine a user's permission.
