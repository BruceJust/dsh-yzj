# @dsh-yzj/tool-yzj

Model-facing Yunzhijia tools over `ctx.yzjBridge`. This package owns tool schemas, digest rendering, budget caps, and the structured UI payload projection; the CLI channel stays in `@dsh-yzj/bridge`.

## Tools

| Domain | Tools |
| ------ | ----- |
| contact | `yzj_whoami`, `yzj_contact_search`, `yzj_contact_get` |
| doc | `yzj_doc_workspace_list/get/create`, `yzj_doc_list/get/recent/create/rename/move/delete/import/download_url`, `yzj_doc_block_list/insert/update/delete` |
| sheet | `yzj_sheet_create/get`, `yzj_sheet_table_get/create/rename/delete`, `yzj_sheet_record_list/create/update/delete` |
| calendar | `yzj_calendar_event_list/get/create/update/delete/participants`, `yzj_calendar_room_find` |
| im | `yzj_im_message_send/list`, `yzj_im_group_recent` |
| file | `yzj_file_upload`, `yzj_file_download` |

Every tool returns `{ content, truncated, data }`:

- `content` — the model-facing digest capped at `maxRenderChars` (rendered through `output.render`).
- `data` — the capped structured payload projected through `output.presentationMeta`. **Never model-visible**; persisted with the session log (`tool/result` meta) so the browser UI reproduces the card on live and replay paths alike.

## Approval guard

`tools/pre-execute` returns `{ kind: 'ask', reason }` for operations that must never run unconfirmed: `yzj_doc_delete`, `yzj_doc_move`, `yzj_doc_block_delete`, `yzj_sheet_table_delete`, `yzj_sheet_record_delete`, `yzj_calendar_event_delete`, `yzj_im_message_send`, `yzj_file_upload`, and `yzj_file_download` with `overwrite: true`. The composed ApprovalService routes the ask to the GUI approval panel and audits the pair on the session log.

## Config

| Field | Default | Meaning |
| ----- | ------- | ------- |
| `timeoutMs` | `60000` | Cooperative timeout per tool call. |
| `maxRenderChars` | `30000` | Cap on model-facing digest characters. |
| `maxMetaChars` | `50000` | Cap on the UI presentation payload characters (after clipping). |

## Model Experience

Read tools return one digest line per record with stable formats (`- [类型] 标题 (id) · 更新时间`); write tools return the operation summary plus the doc link (`https://www.yunzhijia.com/knowledge/lingee/#/store/doc/<DOC_ID>`) per the yzj-cli contract. Bridge failures render as `yzj <label> failed (exit N): <stderr>`. Results append as tool-result content and never alter the request prefix (KV-cache independent).

## Known Limitations and Deferred Work

- **Sheet record shapes are defensive** — record payloads vary by endpoint (`records` / bare array, `fieldsValue` / `fields`); the formatters accept the documented shapes and degrade to compact JSON.
- **Write digests for import/block ops are conservative** — the CLI's response shapes for some write endpoints are opaque; the digest states the operation and returns the doc link, and `data.payload` carries the raw clipped response for the UI.
