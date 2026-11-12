---
type: fact
title: "2026-10-27 agent composer file upload — #350, #351, #353 merged (images, text, PDFs); #354 preview modal + icon-only sent files open; the oRPC multipart boundary patch"
status: active
author: agent:import
confidence: medium
created: 2026-11-10
updated: 2026-11-11
tags:
  - imported/claude-code
approved_at: 2026-11-10
approved_by: auto-approve
---

# 2026-10-27 agent composer file upload — #350, #351, #353 merged (images, text, PDFs); #354 preview modal + icon-only sent files open; the oRPC multipart boundary patch

On 2026-10-27 the user approved the design for file upload in the agent composer:

- **Order:** three PRs, built in this order.
  - PR1, agent + api + backend: `send` takes `attachments`, checked by their header bytes, saved to `agent-workspaces/<conversation>/attachments/`. Images are resized by pi-durable's Photon processor; text is put straight into the message. Each attachment gets a marker in the user message, and `MessageView.attachments` lists them.
  - PR2, webapp: + button, drop and paste. Cards reuse #349's `AttachmentCard`. The thread shows each message's attachments, `agent.attachment` serves thumbnails, and the CSP gains `img-src blob:`.
  - PR3: PDF text extraction plus a `read_attachment` tool; update the docs and privacy pages.
- **Text-only model:** block images in the composer and link to switching models. Do not send them with a placeholder.
- **Paired browsers:** may upload, with the same limits.
- **Limits:** images up to 20 MB each before resizing, at most 5 attachments per message, and text put into the message up to 100 KB.
- **Refused files:** `.pfx`, `.p12`, `.pem` and private keys, judged by the header bytes. In the conversation folder they would reach backups, which breaks invariant 4.
- **Prompt:** an attachment's content is data, as `app_context` is, not instructions. A trading mandate makes prompt injection through an attachment able to send an order.

Built on 2026-10-27:

- PR1 is #350 (`feat/agent-attachments`) and PR2 is #351 (`feat/composer-file-upload`), stacked on it.
- PR1 got two fixes after an automated security review. A conversation id must be a single folder name, since `../x` would have written outside `agent-workspaces`. An image's header is read for its size, and more than 50 MP is refused (`MAX_IMAGE_PIXELS`); images are scaled one at a time with a 60 s thread timeout.
- **Links in the conversation folder:** a later review found that shell commands write in the conversation's folder, so a link could redirect where attachments are written or read. Writes are now new files (`wx`) in a new folder (`mkdir` without `recursive`) whose realpath is checked before and after it is made. `agent.attachment` reads only a regular file of at most 20 MB, opened with `O_NOFOLLOW`, inside that folder. A race with a command running during a send remains, since Node has no `openat`; at worst it creates new files holding the user's own content.
- **oRPC multipart bug:** `@standard-server/peer` sends a FormData body's type as `blob.type`, which browsers lowercase together with the boundary. So any `File` sent through the window port or the device socket failed with "Malformed request". Node tests on both ends never show it, because Node's boundary has no capitals. It is patched (`patches/@standard-server__peer@0.10.3.patch`) and still unfixed upstream in 0.13.0. No upstream issue has been filed; ask before filing one.
- Verified in the built app: picking, pasting, a real OS drag via CDP `Input.dispatchDragEvent`, refusals, blocking on DeepSeek V4 Pro (text only), the thread's thumbnails, and `image (2).png` deduplication.
- #350 and #351 were merged on 2026-10-27. PR3 is #353 (`feat/agent-pdf-attachments`, merged).
  - It reads PDFs with unpdf 1.9.1, which bundles pdf.js 6.4.299 and has no `eval`, in a worker thread with a 60 s limit and a 1 GB heap.
  - pdf.js's CMaps come from pdfjs-dist 6.4.299 (a devDependency) and are copied to `dist/utility/cmaps`. `@napi-rs/canvas` is kept out by `ignoredOptionalDependencies`.
  - Measured: a PDF with a predefined CMap (UniCNS-UCS2-H) and no embedded font reads as empty text without CMaps. Chrome's PDFs need none, but they map characters to Kangxi radicals (⽑), which `pdfText` NFKC-normalises.
  - Text over 100 KB is no longer refused. Its tag carries `characters="N"` and no text, and `read_attachment` reads 20k characters from `start` or searches. A PDF's text is kept in `.text/<name>.txt`.
  - A locked or scanned (text-less) PDF is refused at send.
  - The privacy, files and agent docs pages were updated.
  - The kit's scripted turns index by the tool_result count of the whole conversation, so a later message's turns list must be padded.
  - The user's call (2026-10-27): keep only what the agent reads, once, as pi's coding agent keeps no copy of a file.
    - Images keep only the scaled base64 in the transcript; thumbnails come back through `agent.attachmentImage({ id, messageId, index })`.
    - PDFs keep only `<name>.pdf.txt`; text files are kept as attached.
    - Tags are `name=… [path=…] type size [pages] [characters]`, and attributes are parsed in any order.
    - The `beforeRequest` hook (externalizing images) was rejected for prompt-cache and context-estimate reasons.

- 2026-10-28, PR #354 (`feat/attachment-preview`, merged), asked by the user: pressing a file in the composer or a sent message opens a modal preview of what the agent reads (image, text, a PDF's read text, first 100,000 characters). Sent messages show files as 48px icons with a name/type/size tooltip. New `agent.attachmentText` (null once a command removed the kept file, shown as an i18n message) and `agent.fileText` (pending PDF text through the same worker); `carriedFile` replaced `attachmentImage` in transcript/runtime. My picks: a pending PDF previews its extracted text, not the PDF itself (no plugin/CSP change), and the 48px icon size.

Background facts:

- pi-ai's user content is only text and image.
- `AgentModelOption` lacks the model's input modalities.
- oRPC carrying a `Blob` over the window's three MessagePort hops was not yet verified when the design was approved; the built-app check above showed it works once the multipart patch is in.

Related: [[solyx-composer-attachments]], [[solyx-agent-work-steps]]

> Imported from Claude Code memory (`/Users/chia1104/.claude/projects/-Users-chia1104-Documents-GitHub-solyx/memory/solyx-chat-file-upload.md`, type `project`).
