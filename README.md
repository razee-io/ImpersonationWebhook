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
|**Authenticated user can impersonate**|not changed|authenticated user|
|**Authenticated user can impersonate**|authenticated user|authenticated user|

**Note**: "user" implies normal users or service accounts, whichever applicable.

The webhook relies on the `authorization.k8s.io` API group, specifically
`SubjectAccessReview` API, to determine the authenticated user's permission.

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
authority, and rotation strategy. The certificate used in
`./kubernetes/impersonation-webhook/resource.yaml` is a self-signed certificate
and serves as a placeholder only.

For your reference, the self-signed certificate, which should work for demo
purpose, was created with the following command:

```bash
openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes -keyout server.key 
-out server.crt -subj "/CN=impersonation-webhook.default.svc" 
-addext "subjectAltName=DNS:impersonation-webhook.default.svc"
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
