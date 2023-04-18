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
Refer to [role-based access control](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
and [checking-api-access](https://kubernetes.io/docs/reference/access-authn-authz/authorization/#checking-api-access)
for more information.

Since this webhook has already performed the validation, downstream razee
controllers will respect `clusterAuth.impersonateUser` value and impersonate
the specified user.

## Installation

[Razee Deploy Delta](https://github.com/razee-io/razeedeploy-delta) is the
recommended way to install this webhook.

Communication between admission controllers and webhooks is via HTTPS:

- Webhook servers must present a valid certificate. The certificate and key are
  stored in `impersonation` secret.
- Admission controllers will validate the presented certificate by using the
  certificate authority set in `caBundle` field in `impersonation-webhook`
  MutatingWebhookConfiguration.

Note: [Razee Deploy Delta](https://github.com/razee-io/razeedeploy-delta) will
deploy the webhook with a self-signed certificate by default. Custom
certificate can be used by updating `impersonation` secret and
`impersonation-webhook` MutatingWebhookConfiguration.

For your reference, a self-signed certificate can be quickly created with the
following command for demo purpose:

```bash
openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes -keyout server.key 
-out server.crt -subj "/CN=impersonation-webhook.{NAMESPACE}.svc" 
-addext "subjectAltName=DNS:impersonation-webhook.{NAMESPACE}.svc"
```

## Customize the webhook

The optional `razeedeploy-config` ConfigMap can be used to customize the
webhook.

Because the ConfigMap is optional, if it is created after the ImpersonationWebhook
deployment, you must restart ImpersonationWebhook deployment's
pods, so the deployment can mount the ConfigMap as a volume.

Example:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: razeedeploy-config
  namespace: razee
data:
  enable-impersonation: "false"
```

### Enable User Impersonation

With `enable-impersonation` set to "false" (default), the webhook will not
perform permission validation.

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
