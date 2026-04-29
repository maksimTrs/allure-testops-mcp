import type { AllureApiClient } from "../client.js";

type QueryValue = string | number | boolean | Array<string | number | boolean>;
type QueryParams = Record<string, QueryValue | undefined>;

type JsonRecord = Record<string, unknown>;
type CustomFieldValueRef = { id?: number; name?: string };
type CustomFieldBulkAddValue = CustomFieldValueRef & { customField: { id: number } };
type TestTagRef = { id?: number; name?: string };
type ExternalLinkRef = { url: string; name?: string; type?: string };

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" ? (value as JsonRecord) : undefined;
}

function toCustomFieldValueRef(
  value: unknown,
  index: number,
  source: "values" | "flat",
): CustomFieldValueRef {
  const row = asRecord(value);
  if (!row) {
    throw new Error(`"payload[${index}]" must be an object.`);
  }

  const id = typeof row.id === "number" ? row.id : undefined;
  const name = typeof row.name === "string" ? row.name : undefined;
  if (id === undefined && name === undefined) {
    if (source === "values") {
      throw new Error(
        `"payload[${index}].values[]" items must include at least one of "id" or "name".`,
      );
    }
    throw new Error(`"payload[${index}]" must include at least one of "id" or "name".`);
  }

  return {
    ...(id !== undefined ? { id } : {}),
    ...(name !== undefined ? { name } : {}),
  };
}

export function normalizeCustomFieldBulkAddPayload(payload: unknown): CustomFieldBulkAddValue[] {
  if (!Array.isArray(payload)) {
    throw new Error("\"payload\" must be an array.");
  }

  const flattened: CustomFieldBulkAddValue[] = [];

  payload.forEach((entry, index) => {
    const row = asRecord(entry);
    if (!row) {
      throw new Error(`"payload[${index}]" must be an object.`);
    }

    const customField = asRecord(row.customField);
    const customFieldId = customField && typeof customField.id === "number"
      ? customField.id
      : undefined;
    if (customFieldId === undefined) {
      throw new Error(`"payload[${index}].customField.id" must be a number.`);
    }

    if ("values" in row) {
      if (!Array.isArray(row.values)) {
        throw new Error(`"payload[${index}].values" must be an array.`);
      }
      const values = row.values.map((value) => ({
        customField: { id: customFieldId },
        ...toCustomFieldValueRef(value, index, "values"),
      }));
      flattened.push(...values);
      return;
    }

    // Backward-compatible input shape support:
    // [{ id, name, customField: { id } }] -> bulk add cfv payload
    const flatValue = toCustomFieldValueRef(row, index, "flat");
    flattened.push({
      customField: { id: customFieldId },
      ...flatValue,
    });
  });

  if (flattened.length === 0) {
    throw new Error("\"payload\" must contain at least one custom field value.");
  }

  return flattened;
}

export function listTestCases(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/testcase", {
    projectId,
    ...query,
  });
}

export function searchTestCases(
  client: AllureApiClient,
  projectId: number,
  rql: string,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/testcase/__search", {
    projectId,
    rql,
    ...query,
  });
}

export function getTestCase(client: AllureApiClient, id: number): Promise<unknown> {
  return client.get(`/api/testcase/${id}`);
}

export function createTestCase(
  client: AllureApiClient,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/testcase", payload);
}

export function updateTestCase(
  client: AllureApiClient,
  id: number,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return client.patch(`/api/testcase/${id}`, payload);
}

export function deleteTestCase(client: AllureApiClient, id: number): Promise<unknown> {
  return client.delete(`/api/testcase/${id}`);
}

export function getTestCaseOverview(client: AllureApiClient, testCaseId: number): Promise<unknown> {
  return client.get(`/api/testcase/${testCaseId}/overview`);
}

export function getTestCaseHistory(
  client: AllureApiClient,
  id: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/testcase/${id}/history`, query);
}

export function getTestCaseScenario(client: AllureApiClient, id: number): Promise<unknown> {
  return client.get(`/api/testcase/${id}/step`);
}

export function getTestCaseTags(client: AllureApiClient, testCaseId: number): Promise<unknown> {
  return client.get(`/api/testcase/${testCaseId}/tag`);
}

export function setTestCaseTags(
  client: AllureApiClient,
  testCaseId: number,
  payload: unknown,
): Promise<unknown> {
  return client.post(`/api/testcase/${testCaseId}/tag`, payload);
}

export function getTestCaseIssues(client: AllureApiClient, testCaseId: number): Promise<unknown> {
  return client.get(`/api/testcase/${testCaseId}/issue`);
}

export function setTestCaseIssues(
  client: AllureApiClient,
  testCaseId: number,
  payload: unknown,
): Promise<unknown> {
  return client.post(`/api/testcase/${testCaseId}/issue`, payload);
}

export function restoreTestCase(client: AllureApiClient, id: number): Promise<unknown> {
  return client.post(`/api/testcase/${id}/restore`);
}

export function listProjectCustomFields(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/project/${projectId}/cf`, query);
}

export function listCustomFieldValues(
  client: AllureApiClient,
  projectId: number,
  customFieldId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/project/${projectId}/cfv`, {
    customFieldId,
    ...query,
  });
}

export function getTestCaseCustomFields(
  client: AllureApiClient,
  testCaseId: number,
  projectId: number,
): Promise<unknown> {
  return client.get(`/api/testcase/${testCaseId}/cfv`, {
    projectId,
  });
}

export function setTestCaseCustomFields(
  client: AllureApiClient,
  projectId: number,
  testCaseId: number,
  payload: unknown,
): Promise<unknown> {
  const cfv = normalizeCustomFieldBulkAddPayload(payload);
  return client.post("/api/v2/test-case/bulk/cfv/add", {
    selection: {
      projectId,
      testCasesInclude: [testCaseId],
      inverted: false,
    },
    cfv,
  });
}

export function addTagsToTestCases(
  client: AllureApiClient,
  projectId: number,
  testCaseIds: number[],
  tags: TestTagRef[],
): Promise<unknown> {
  return client.post("/api/v2/test-case/bulk/tag/add", {
    selection: {
      projectId,
      testCasesInclude: testCaseIds,
      inverted: false,
    },
    tags,
  });
}

export function removeTagsFromTestCases(
  client: AllureApiClient,
  projectId: number,
  testCaseIds: number[],
  tagIds: number[],
): Promise<unknown> {
  return client.post("/api/v2/test-case/bulk/tag/remove", {
    selection: {
      projectId,
      testCasesInclude: testCaseIds,
      inverted: false,
    },
    ids: tagIds,
  });
}

export function addExternalLinksToTestCases(
  client: AllureApiClient,
  projectId: number,
  testCaseIds: number[],
  links: ExternalLinkRef[],
): Promise<unknown> {
  return client.post("/api/v2/test-case/bulk/external-link/add", {
    selection: {
      projectId,
      testCasesInclude: testCaseIds,
      inverted: false,
    },
    links,
  });
}

export function removeCustomFieldsFromTestCases(
  client: AllureApiClient,
  projectId: number,
  testCaseIds: number[],
  customFieldIds: number[],
): Promise<unknown> {
  return client.post("/api/v2/test-case/bulk/cfv/remove", {
    selection: {
      projectId,
      testCasesInclude: testCaseIds,
      inverted: false,
    },
    ids: customFieldIds,
  });
}

export function bulkSetTestCaseCustomFields(
  client: AllureApiClient,
  projectId: number,
  testCaseIds: number[],
  payload: unknown,
): Promise<unknown> {
  const cfv = normalizeCustomFieldBulkAddPayload(payload);
  return client.post("/api/v2/test-case/bulk/cfv/add", {
    selection: {
      projectId,
      testCasesInclude: testCaseIds,
      inverted: false,
    },
    cfv,
  });
}

export function deleteCustomFieldValue(
  client: AllureApiClient,
  valueId: number,
): Promise<unknown> {
  return client.delete(`/api/cfv/${valueId}`);
}

export function renameCustomFieldValue(
  client: AllureApiClient,
  valueId: number,
  newName: string,
): Promise<unknown> {
  return client.patch(`/api/cfv/${valueId}`, { name: newName });
}

export function getTestCaseComments(
  client: AllureApiClient,
  testCaseId: number,
  query: QueryParams = {},
): Promise<unknown> {
  return client.get("/api/comment", { testCaseId, ...query });
}

export function addTestCaseComment(
  client: AllureApiClient,
  testCaseId: number,
  body: string,
): Promise<unknown> {
  return client.post("/api/comment", { testCaseId, body });
}

export function deleteTestCaseComment(
  client: AllureApiClient,
  commentId: number,
): Promise<unknown> {
  return client.delete(`/api/comment/${commentId}`);
}

export function updateTestCaseComment(
  client: AllureApiClient,
  commentId: number,
  body: string,
): Promise<unknown> {
  return client.patch(`/api/comment/${commentId}`, { body });
}

export function deleteTestCaseAttachment(
  client: AllureApiClient,
  attachmentId: number,
): Promise<unknown> {
  return client.delete(`/api/testcase/attachment/${attachmentId}`);
}

type ProseMirrorDoc = {
  type: "doc";
  content: Array<Record<string, unknown>>;
};

export function buildPlainTextBodyJson(text: string): ProseMirrorDoc {
  const lines = text.split("\n");
  const paragraphs = lines.map((line) =>
    line.length === 0
      ? { type: "paragraph" }
      : {
          type: "paragraph",
          content: [{ type: "text", text: line }],
        },
  );
  return { type: "doc", content: paragraphs };
}

export type AddStepPayload =
  | { testCaseId: number; bodyJson: unknown }
  | { testCaseId: number; attachmentId: number };

export function addTestCaseStep(
  client: AllureApiClient,
  payload: AddStepPayload,
  query: { afterId?: number; withExpectedResult?: boolean } = {},
): Promise<unknown> {
  const queryParams: Record<string, string | number | boolean | undefined> = {};
  if (query.afterId !== undefined) queryParams.afterId = query.afterId;
  if (query.withExpectedResult !== undefined) {
    queryParams.withExpectedResult = query.withExpectedResult;
  }
  return client.post("/api/testcase/step", payload, queryParams);
}

export async function addTestCaseStepWithFile(
  client: AllureApiClient,
  testCaseId: number,
  file: AttachmentUploadInput,
  options: { afterId?: number; withExpectedResult?: boolean } = {},
): Promise<{ uploadedAttachment: unknown; stepResult: unknown }> {
  const uploadResult = await uploadTestCaseAttachments(client, testCaseId, [file]);
  const arr = Array.isArray(uploadResult) ? uploadResult : [];
  const first = arr[0] as { id?: number } | undefined;
  const attachmentId = first?.id;
  if (typeof attachmentId !== "number") {
    throw new Error(
      `add_test_case_step_with_file: upload did not return an attachment id; got ${JSON.stringify(uploadResult)}`,
    );
  }
  const stepResult = await addTestCaseStep(
    client,
    { testCaseId, attachmentId },
    options,
  );
  return { uploadedAttachment: first, stepResult };
}

export function updateTestCaseStep(
  client: AllureApiClient,
  stepId: number,
  bodyJson: unknown,
  query: { withExpectedResult?: boolean } = {},
): Promise<unknown> {
  const queryParams: Record<string, string | number | boolean | undefined> = {};
  if (query.withExpectedResult !== undefined) {
    queryParams.withExpectedResult = query.withExpectedResult;
  }
  return client.patch(`/api/testcase/step/${stepId}`, { bodyJson }, queryParams);
}

export function deleteTestCaseStep(
  client: AllureApiClient,
  stepId: number,
): Promise<unknown> {
  return client.delete(`/api/testcase/step/${stepId}`);
}

export function listTestCaseAttachments(
  client: AllureApiClient,
  testCaseId: number,
  query: QueryParams = {},
): Promise<unknown> {
  return client.get("/api/testcase/attachment", { testCaseId, ...query });
}

export type AttachmentUploadInput = {
  path?: string;
  base64?: string;
  name?: string;
  mimeType?: string;
};

export async function uploadTestCaseAttachments(
  client: AllureApiClient,
  testCaseId: number,
  files: AttachmentUploadInput[],
): Promise<unknown> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const form = new FormData();
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    let bytes: Uint8Array;
    let filename: string;
    if (file.path) {
      const data = await fs.readFile(file.path);
      bytes = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      filename = file.name ?? path.basename(file.path);
    } else if (file.base64) {
      const buf = Buffer.from(file.base64, "base64");
      bytes = new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      filename = file.name ?? `upload-${Date.now()}-${i}`;
    } else {
      throw new Error(`files[${i}] must include either "path" or "base64".`);
    }
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([ab], { type: file.mimeType ?? "application/octet-stream" });
    form.append("file", blob, filename);
  }

  return client.postMultipart("/api/testcase/attachment", form, { testCaseId });
}

export async function downloadTestCaseAttachmentContent(
  client: AllureApiClient,
  attachmentId: number,
  options: { savePath?: string } = {},
): Promise<{
  attachmentId: number;
  contentType: string;
  contentLength: number;
  savedTo?: string;
  base64?: string;
}> {
  const { contentType, bytes } = await client.getBinary(
    `/api/testcase/attachment/${attachmentId}/content`,
  );

  if (options.savePath) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(options.savePath, bytes);
    return {
      attachmentId,
      contentType,
      contentLength: bytes.byteLength,
      savedTo: options.savePath,
    };
  }

  return {
    attachmentId,
    contentType,
    contentLength: bytes.byteLength,
    base64: Buffer.from(bytes).toString("base64"),
  };
}
