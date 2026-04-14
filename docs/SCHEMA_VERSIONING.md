# Structured JSON Schema versioning and publishing

This document defines how XcodeBuildMCP versions and publishes the JSON Schemas for
structured output fixtures and runtime payloads.

## Goals

- Keep schema contracts stable and predictable for external consumers.
- Make published schema URLs real, durable, and safe to reference.
- Let the website serve schemas directly from `https://xcodebuildmcp.com/schemas/...`.
- Avoid ambiguous compatibility rules.

## Canonical schema identity

Each schema has two stable identifiers:

1. The payload metadata:
   ```json
   {
     "schema": "xcodebuildmcp.output.build-result",
     "schemaVersion": "1"
   }
   ```
2. The published schema file path:
   ```text
   https://xcodebuildmcp.com/schemas/structured-output/xcodebuildmcp.output.build-result/1.schema.json
   ```

The in-payload `schema` and `schemaVersion` values must always match the published
schema document that validates that payload.

## Version format

`schemaVersion` uses integer strings only:

- `"1"`
- `"2"`
- `"3"`

Do not use semver-style schema versions such as `"1.1"` or `"2.0"`.

The version number is a contract version, not a release number.

## Versioning rules

### Published versions are immutable

Once a schema version is published, do not make breaking changes to that file.

Breaking changes include:

- removing a property
- making an optional property required
- narrowing allowed values or enums
- changing object shape incompatibly
- changing field meaning in a way that could break clients

If any of those changes are needed, publish a new version instead:

```text
schemas/structured-output/xcodebuildmcp.output.build-result/2.schema.json
```

and emit:

```json
"schemaVersion": "2"
```

### Old versions remain available

Previously published schema files must continue to be hosted.

Do not remove old schema versions from the website once consumers may rely on them.

### Additive changes

Additive, optional fields can be compatible, but use caution.

If a new field is truly optional and old clients can safely ignore it, it may remain
within the same schema version. If there is any doubt about compatibility or meaning,
bump the schema version.

Bias toward a new version when the contract meaning changes.

## Directory layout

Source schemas in this repository live under:

```text
schemas/structured-output/
```

Published schemas on the website live under:

```text
public/schemas/structured-output/
```

A source file such as:

```text
schemas/structured-output/xcodebuildmcp.output.build-result/1.schema.json
```

is published to:

```text
public/schemas/structured-output/xcodebuildmcp.output.build-result/1.schema.json
```

which is then served at:

```text
https://xcodebuildmcp.com/schemas/structured-output/xcodebuildmcp.output.build-result/1.schema.json
```

## Publishing workflow

Schema publishing is handled from this repository by a GitHub Actions workflow.

Trigger conditions:

- push to `main` when files under `schemas/**` change
- manual `workflow_dispatch`

Publishing steps:

1. Check out this repository.
2. Clone `getsentry/xcodebuildmcp.com` over SSH.
3. Sync `schemas/structured-output/` from this repository into
   `public/schemas/structured-output/` in the website repository.
4. Commit the website change if the published files changed.
5. Push to the website repository `main` branch.
6. Let Vercel deploy the website normally.

This keeps schema authoring in the main project repository while using the website
repository as the deployment surface.

## Required secret

The publishing workflow requires this repository secret:

```text
XCODEBUILDMCP_WEBSITE_DEPLOY_KEY
```

This secret must contain an SSH private key with write access to:

```text
git@github.com:getsentry/xcodebuildmcp.com.git
```

The corresponding public key should be installed as a deploy key on the website
repository with write access.

### Deploy key setup

1. Generate a dedicated SSH key pair for schema publishing.
   ```bash
   ssh-keygen -t ed25519 -C "schema-publisher" -f ./xcodebuildmcp-website-deploy-key
   ```
2. In `getsentry/xcodebuildmcp.com`, add the public key as a deploy key with write
   access.
   - GitHub, Settings, Deploy keys
   - Add `xcodebuildmcp-website-deploy-key.pub`
   - Enable write access
3. In `getsentry/XcodeBuildMCP`, add the private key as an actions secret named:
   ```text
   XCODEBUILDMCP_WEBSITE_DEPLOY_KEY
   ```
4. Trigger the `Publish Schemas` workflow manually once to verify SSH access and sync.
5. Confirm that the website repository receives the commit and Vercel deploys it.
6. Confirm a final URL resolves, for example:
   ```text
   https://xcodebuildmcp.com/schemas/structured-output/xcodebuildmcp.output.build-result/1.schema.json
   ```

Use a dedicated deploy key for this workflow only. Do not reuse a personal SSH key.

## Consumer guidance

Consumers should branch on both `schema` and `schemaVersion`.

Example:

```ts
switch (`${payload.schema}@${payload.schemaVersion}`) {
  case "xcodebuildmcp.output.build-result@1":
    // validate using v1 schema
    break
  case "xcodebuildmcp.output.build-result@2":
    // validate using v2 schema
    break
  default:
    throw new Error("Unsupported schema version")
}
```

These JSON Schemas describe payload shapes. They are not an OpenAPI description by
themselves. If an HTTP API is introduced later, OpenAPI should reference the schema
files as component schemas instead of trying to infer endpoints from them.

## Maintenance checklist

When updating schemas:

1. Decide whether the change is compatible or breaking.
2. If breaking, add a new versioned schema file instead of changing the old one.
3. Update fixture payloads to emit the correct `schemaVersion`.
4. Run:
   ```bash
   npm run test:schema-fixtures
   ```
5. Merge to `main`.
6. Confirm the publish workflow updated the website repo.
7. Confirm the final schema URL resolves on the website.
