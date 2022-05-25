# ImpersonationWebhook

This admission webhook supports impersonation feature
provided by Razee controllers by intercepting requests
that create razee resources
(such as [RemoteResource](https://github.com/razee-io/RemoteResource) and
[MustacheTemplate](https://github.com/razee-io/MustacheTemplate)) and
updates the `spec.clusterAuth.impersonateUser` field accordingly based
on the following rules:

Case 1: The authenticated user does NOT have impersonate permission

- If `clusterAuth.impersonateUser` is not set, set `clusterAuth.impersonateUser`
  to the authenticated user.
- If `clusterAuth.impersonateUser` is set, set `clusterAuth.impersonateUser`
  to the authenticated user.

Case 2: The authenticated user has impersonate permission

- If `clusterAuth.impersonateUser` is not set, set `clusterAuth.impersonateUser`
  to the authenticated user.
- If `clusterAuth.impersonateUser` is set, do not change.

## Installation

TODO
