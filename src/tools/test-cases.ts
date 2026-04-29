import type { AllureApiClient } from "../client.js";
import * as api from "../api/test-cases.js";
import type { ToolBundle } from "./types.js";
import {
  asObject,
  ensureProjectIdInPayload,
  getOptionalBoolean,
  getObjectPayload,
  getOptionalNumber,
  getOptionalString,
  getRequiredId,
  getRequiredNumber,
  getRequiredString,
  pickPagination,
  resolveProjectId,
} from "./utils.js";

type ToolObject = Record<string, unknown>;
type BulkTag = { id?: number; name?: string };
type BulkExternalLink = { url: string; name?: string; type?: string };

function asArray(value: unknown): unknown[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("Expected an array.");
  }
  return value;
}

function getBulkIdList(
  args: ToolObject,
  singleKey: string,
  multipleKey: string,
  entityLabel: string,
): number[] {
  const ids: number[] = [];

  const single = args[singleKey];
  if (single !== undefined) {
    if (typeof single !== "number" || Number.isNaN(single)) {
      throw new Error(`"${singleKey}" must be a number when provided.`);
    }
    ids.push(single);
  }

  const multiple = args[multipleKey];
  if (multiple !== undefined) {
    const values = asArray(multiple);
    if (!values || values.some((item) => typeof item !== "number" || Number.isNaN(item))) {
      throw new Error(`"${multipleKey}" must be an array of numbers when provided.`);
    }
    ids.push(...(values as number[]));
  }

  if (ids.length === 0) {
    throw new Error(
      `Either "${singleKey}" or "${multipleKey}" must be provided with at least one ${entityLabel} ID.`,
    );
  }

  return [...new Set(ids)];
}

function normalizeBulkTags(args: ToolObject): BulkTag[] {
  const items: unknown[] = [];
  if (args.tag !== undefined) {
    items.push(args.tag);
  }
  if (args.tags !== undefined) {
    const tags = asArray(args.tags);
    if (!tags) {
      throw new Error("\"tags\" must be an array when provided.");
    }
    items.push(...tags);
  }

  if (items.length === 0) {
    throw new Error("Either \"tag\" or \"tags\" must be provided with at least one tag.");
  }

  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`"tags[${index}]" must be an object.`);
    }
    const row = item as ToolObject;
    const id = typeof row.id === "number" ? row.id : undefined;
    const name = typeof row.name === "string" ? row.name : undefined;
    if (id === undefined && (name === undefined || name.trim().length === 0)) {
      throw new Error(`"tags[${index}]" must include at least one of "id" or non-empty "name".`);
    }
    return {
      ...(id !== undefined ? { id } : {}),
      ...(name !== undefined ? { name } : {}),
    };
  });
}

function extractCustomFieldIds(payload: unknown): number[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  const ids = new Set<number>();
  for (const entry of payload) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const row = entry as ToolObject;
      const cf = row.customField;
      if (cf && typeof cf === "object" && !Array.isArray(cf)) {
        const id = (cf as ToolObject).id;
        if (typeof id === "number" && !Number.isNaN(id)) {
          ids.add(id);
        }
      }
    }
  }
  return [...ids];
}

function normalizeBulkExternalLinks(args: ToolObject): BulkExternalLink[] {
  const items: unknown[] = [];
  if (args.link !== undefined) {
    items.push(args.link);
  }
  if (args.links !== undefined) {
    const links = asArray(args.links);
    if (!links) {
      throw new Error("\"links\" must be an array when provided.");
    }
    items.push(...links);
  }

  if (items.length === 0) {
    throw new Error("Either \"link\" or \"links\" must be provided with at least one external link.");
  }

  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`"links[${index}]" must be an object.`);
    }
    const row = item as ToolObject;
    const url = typeof row.url === "string" ? row.url.trim() : "";
    if (url.length === 0) {
      throw new Error(`"links[${index}].url" must be a non-empty string.`);
    }
    const name = row.name;
    if (name !== undefined && typeof name !== "string") {
      throw new Error(`"links[${index}].name" must be a string when provided.`);
    }
    const type = row.type;
    if (type !== undefined && typeof type !== "string") {
      throw new Error(`"links[${index}].type" must be a string when provided.`);
    }
    return {
      url,
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof type === "string" ? { type } : {}),
    };
  });
}

export function createTestCaseTools(
  client: AllureApiClient,
): ToolBundle {
  const tools = [
    {
      name: "list_test_cases",
      description: "List test cases for a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number" },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          search: { type: "string" },
          filterId: { type: "number" },
          page: { type: "number" },
          size: { type: "number" },
          sort: { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      name: "search_test_cases",
      description:
        "Search test cases by RQL query. " +
        "RQL examples: " +
        'cf["Feature"] = "Auth" — match custom field value; ' +
        'cf["Feature"] is empty — field not set; ' +
        'not cf["Feature"] = "Auth" — negation; ' +
        'cf["Suite"] = "API" and cf["Feature"] is empty — combined conditions; ' +
        "name ~ \"login\" — name contains substring; " +
        "tag = \"smoke\" — filter by tag. " +
        "Use page/size for pagination; the API may truncate large result sets.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number" },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          rql: {
            type: "string",
            description:
              "RQL query string. Operators: = (equals), ~ (contains), is empty (field not set), " +
              "not (negation), and/or (combinators). " +
              'Custom field syntax: cf["FieldName"]. Example: cf["Feature"] = "Auth"',
          },
          page: { type: "number", description: "Page number (0-based)." },
          size: { type: "number", description: "Page size (default varies by server)." },
          sort: { type: "array", items: { type: "string" } },
        },
        required: ["rql"],
      },
    },
    {
      name: "get_test_case",
      description: "Get a test case by ID.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
    {
      name: "create_test_case",
      description:
        "Create a new test case. payload.projectId defaults to ALLURE_PROJECT_ID env when omitted. payload.customFields supports values like { customField: { id }, id, name }.",
      inputSchema: {
        type: "object" as const,
        properties: {
          payload: { type: "object", additionalProperties: true },
        },
        required: ["payload"],
      },
    },
    {
      name: "update_test_case",
      description:
        "Update an existing test case. " +
        "WARNING: payload.customFields REPLACES all custom fields — any field not included will be removed. " +
        "To update a single custom field safely, use set_test_case_custom_fields or " +
        "bulk_set_test_case_custom_fields instead. " +
        "payload.customFields supports values like { customField: { id }, id, name }.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number" },
          payload: { type: "object", additionalProperties: true },
        },
        required: ["id", "payload"],
      },
    },
    {
      name: "delete_test_case",
      description: "Delete a test case by ID.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
    {
      name: "add_test_case_tags_bulk",
      description:
        "Add one or multiple tags to one or multiple test cases using bulk API.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number" },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          testCaseId: { type: "number" },
          testCaseIds: { type: "array", items: { type: "number" } },
          tag: { type: "object", additionalProperties: true },
          tags: { type: "array", items: { type: "object" } },
        },
      },
    },
    {
      name: "remove_test_case_tags_bulk",
      description:
        "Remove one or multiple tags from one or multiple test cases using bulk API.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number" },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          testCaseId: { type: "number" },
          testCaseIds: { type: "array", items: { type: "number" } },
          tagId: { type: "number" },
          tagIds: { type: "array", items: { type: "number" } },
        },
      },
    },
    {
      name: "add_test_case_external_links_bulk",
      description:
        "Add one or multiple external links to one or multiple test cases using bulk API.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number" },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          testCaseId: { type: "number" },
          testCaseIds: { type: "array", items: { type: "number" } },
          link: { type: "object", additionalProperties: true },
          links: { type: "array", items: { type: "object" } },
        },
      },
    },
    {
      name: "get_test_case_overview",
      description: "Get test case overview data.",
      inputSchema: {
        type: "object" as const,
        properties: { testCaseId: { type: "number" } },
        required: ["testCaseId"],
      },
    },
    {
      name: "get_test_case_history",
      description: "Get test case run history.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number" },
          page: { type: "number" },
          size: { type: "number" },
          sort: { type: "array", items: { type: "string" } },
        },
        required: ["id"],
      },
    },
    {
      name: "get_test_case_scenario",
      description: "Get scenario step tree for a test case, including shared step expansion. Returns root.children (top-level step ids), scenarioSteps (id -> step, may carry sharedStepId), sharedSteps (id -> shared step container), sharedStepScenarioSteps (id -> step inside a shared step), and attachments / sharedStepAttachments maps.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
    {
      name: "get_test_case_tags",
      description: "Get tags assigned to a test case.",
      inputSchema: {
        type: "object" as const,
        properties: { testCaseId: { type: "number" } },
        required: ["testCaseId"],
      },
    },
    {
      name: "set_test_case_tags",
      description: "Set tags for a test case.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number" },
          payload: { type: "array", items: { type: "object" } },
        },
        required: ["testCaseId", "payload"],
      },
    },
    {
      name: "get_test_case_issues",
      description: "Get linked issues for a test case.",
      inputSchema: {
        type: "object" as const,
        properties: { testCaseId: { type: "number" } },
        required: ["testCaseId"],
      },
    },
    {
      name: "set_test_case_issues",
      description: "Set linked issues for a test case.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number" },
          payload: { type: "array", items: { type: "object" } },
        },
        required: ["testCaseId", "payload"],
      },
    },
    {
      name: "restore_test_case",
      description: "Restore a deleted test case.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
    {
      name: "list_project_custom_fields",
      description: "List custom fields configured for a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number" },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          query: { type: "string" },
          page: { type: "number" },
          size: { type: "number" },
          sort: { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      name: "list_custom_field_values",
      description: "List values for a custom field in a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number" },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          customFieldId: { type: "number" },
          query: { type: "string" },
          global: { type: "boolean" },
          testCaseSearch: { type: "string" },
          page: { type: "number" },
          size: { type: "number" },
          sort: { type: "array", items: { type: "string" } },
        },
        required: ["customFieldId"],
      },
    },
    {
      name: "get_test_case_custom_fields",
      description: "Get custom field values for a test case.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number" },
          projectId: { type: "number" },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
        },
        required: ["testCaseId"],
      },
    },
    {
      name: "set_test_case_custom_fields",
      description:
        "Add custom field values for a test case via bulk API. " +
        "NOTE: This ADDS values without removing existing ones. For multi-select fields, " +
        "the test case may end up with both old and new values. " +
        "To replace values, use remove_test_case_custom_fields first, then this tool. " +
        "Or use bulk_set_test_case_custom_fields with mode=\"replace\". " +
        "Supports grouped values [{ customField: { id }, values: [{ id|name }] }] " +
        "and flat values [{ id|name, customField: { id } }].",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number" },
          projectId: { type: "number" },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          payload: { type: "array", items: { type: "object" } },
        },
        required: ["testCaseId", "payload"],
      },
    },
    {
      name: "remove_test_case_custom_fields",
      description:
        "Remove custom field values from one or multiple test cases via bulk API. " +
        "Pass the custom field IDs whose values should be cleared from the specified test cases.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number" },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          testCaseId: { type: "number", description: "Single test case ID." },
          testCaseIds: { type: "array", items: { type: "number" }, description: "Multiple test case IDs." },
          customFieldId: { type: "number", description: "Single custom field ID to clear." },
          customFieldIds: { type: "array", items: { type: "number" }, description: "Multiple custom field IDs to clear." },
        },
      },
    },
    {
      name: "bulk_set_test_case_custom_fields",
      description:
        "Set custom field values on multiple test cases at once. " +
        "When mode is \"replace\" (default), existing values for the specified fields are removed " +
        "before adding new ones, preventing unintended data accumulation. " +
        "When mode is \"add\", values are added without removing existing ones. " +
        "Payload format: [{ customField: { id }, values: [{ id|name }] }] or " +
        "[{ id|name, customField: { id } }].",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number" },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          testCaseId: { type: "number", description: "Single test case ID." },
          testCaseIds: { type: "array", items: { type: "number" }, description: "Multiple test case IDs." },
          mode: {
            type: "string",
            enum: ["replace", "add"],
            description: "\"replace\" (default): removes existing values for the specified fields before adding. \"add\": appends without removing.",
          },
          payload: { type: "array", items: { type: "object" } },
        },
        required: ["payload"],
      },
    },
    {
      name: "delete_custom_field_value",
      description:
        "Delete a custom field value definition. The value must not be in use by any test cases. " +
        "Use this to clean up orphaned values after reorganizing test cases.",
      inputSchema: {
        type: "object" as const,
        properties: {
          valueId: { type: "number", description: "The ID of the custom field value to delete." },
        },
        required: ["valueId"],
      },
    },
    {
      name: "rename_custom_field_value",
      description:
        "Rename a custom field value. All test cases using this value will automatically reflect the new name.",
      inputSchema: {
        type: "object" as const,
        properties: {
          valueId: { type: "number", description: "The ID of the custom field value to rename." },
          name: { type: "string", description: "The new name for the value." },
        },
        required: ["valueId", "name"],
      },
    },
    {
      name: "merge_custom_field_values",
      description:
        "Merge two custom field values: reassign all test cases from the source value to the target value, " +
        "then delete the source value. Useful for consolidating duplicate or similar values.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number" },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          customFieldId: { type: "number", description: "The custom field ID (e.g. -2 for Feature)." },
          sourceValueId: { type: "number", description: "The value to merge FROM (will be deleted)." },
          targetValueId: { type: "number", description: "The value to merge INTO (will be kept)." },
        },
        required: ["customFieldId", "sourceValueId", "targetValueId"],
      },
    },
    {
      name: "search_test_cases_by_missing_field",
      description:
        "Find test cases where a specific custom field is not set. " +
        "Convenience wrapper that builds the RQL query cf[\"FieldName\"] is empty.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number" },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          fieldName: { type: "string", description: "The custom field name (e.g. \"Feature\", \"Suite\")." },
          additionalRql: {
            type: "string",
            description: "Optional extra RQL filter to combine with the missing-field condition using AND.",
          },
          page: { type: "number", description: "Page number (0-based)." },
          size: { type: "number", description: "Page size." },
          sort: { type: "array", items: { type: "string" } },
        },
        required: ["fieldName"],
      },
    },
    {
      name: "get_test_case_comments",
      description:
        "List comments on a test case. Returns a paginated response with id, body, bodyHtml, testCaseId, createdDate, createdBy. Append-only — does not modify any data.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number" },
          page: { type: "number", description: "Page number (0-based)." },
          size: { type: "number", description: "Page size." },
          sort: { type: "array", items: { type: "string" } },
        },
        required: ["testCaseId"],
      },
    },
    {
      name: "add_test_case_comment",
      description:
        "Add a new comment to a test case. Append-only — never affects existing comments. Server fills in bodyHtml, createdDate, createdBy automatically. Returns the created comment with its id.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number" },
          body: { type: "string", description: "Comment body. Markdown allowed." },
        },
        required: ["testCaseId", "body"],
      },
    },
    {
      name: "list_test_case_attachments",
      description:
        "List attachments associated with a test case. Returns a paginated response with id, name, contentType, contentLength, missed.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number" },
          page: { type: "number", description: "Page number (0-based)." },
          size: { type: "number", description: "Page size." },
          sort: { type: "array", items: { type: "string" } },
        },
        required: ["testCaseId"],
      },
    },
    {
      name: "upload_test_case_attachments",
      description:
        "Upload one or more files as attachments on a test case (multipart). Each file may be specified either by an absolute filesystem path or by inline base64. Append-only — does not affect existing attachments. Returns an array of created attachments with id, name, contentType, contentLength.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number" },
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description: "Absolute path to the file on the local filesystem (where the MCP server runs).",
                },
                base64: {
                  type: "string",
                  description: "Base64-encoded file content. Use either path or base64, not both.",
                },
                name: {
                  type: "string",
                  description: "Filename to register on Allure. Defaults to basename of path or generated name for base64.",
                },
                mimeType: {
                  type: "string",
                  description: "MIME type. Defaults to application/octet-stream.",
                },
              },
            },
          },
        },
        required: ["testCaseId", "files"],
      },
    },
    {
      name: "download_test_case_attachment_content",
      description:
        "Download the binary content of a test case attachment. If savePath is provided, the file is written there and metadata is returned. Otherwise the body is returned base64-encoded.",
      inputSchema: {
        type: "object" as const,
        properties: {
          attachmentId: { type: "number" },
          savePath: {
            type: "string",
            description: "Optional absolute filesystem path where the attachment will be written. If omitted, base64-encoded body is returned in the response.",
          },
        },
        required: ["attachmentId"],
      },
    },
    {
      name: "delete_test_case_comment",
      description: "Delete a comment by id. Affects only the specified comment, leaves all other comments untouched.",
      inputSchema: {
        type: "object" as const,
        properties: { commentId: { type: "number" } },
        required: ["commentId"],
      },
    },
    {
      name: "add_test_case_step",
      description:
        "Append a new manual scenario step to a test case. Pass either body (plain text — wrapped into a single ProseMirror paragraph) or bodyJson (full ProseMirror doc) to provide the step content. afterId controls placement: if provided, the new step is inserted after that step id at the same level; if omitted, the server appends to the end of root.children. Existing steps are never modified or removed.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number" },
          body: {
            type: "string",
            description: "Plain text body. Multi-line strings split into paragraphs. Ignored when bodyJson is provided.",
          },
          bodyJson: {
            type: "object",
            description: "Full ProseMirror doc shape, e.g. {type:\"doc\",content:[{type:\"paragraph\",content:[{type:\"text\",text:\"...\"}]}]}. Wins over body when both are provided.",
          },
          afterId: {
            type: "number",
            description: "Step id after which to insert the new step. If omitted, the step is appended.",
          },
          withExpectedResult: {
            type: "boolean",
            description: "Whether the step should be created with an expected-result child slot. Defaults to false.",
          },
        },
        required: ["testCaseId"],
      },
    },
  ];

  const handlers = {
    list_test_cases: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.listTestCases(client, projectId, {
        search: getOptionalString(args, "search"),
        filterId: getOptionalNumber(args, "filterId"),
        ...pickPagination(args),
      });
    },
    search_test_cases: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.searchTestCases(client, projectId, getRequiredString(args, "rql"), {
        ...pickPagination(args),
      });
    },
    get_test_case: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestCase(client, getRequiredId(args));
    },
    create_test_case: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const payload = ensureProjectIdInPayload(getObjectPayload(args), client);
      return api.createTestCase(client, payload);
    },
    update_test_case: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.updateTestCase(client, getRequiredId(args), getObjectPayload(args));
    },
    delete_test_case: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.deleteTestCase(client, getRequiredId(args));
    },
    add_test_case_tags_bulk: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      const testCaseIds = getBulkIdList(args, "testCaseId", "testCaseIds", "test case");
      const tags = normalizeBulkTags(args);
      return api.addTagsToTestCases(client, projectId, testCaseIds, tags);
    },
    remove_test_case_tags_bulk: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      const testCaseIds = getBulkIdList(args, "testCaseId", "testCaseIds", "test case");
      const tagIds = getBulkIdList(args, "tagId", "tagIds", "tag");
      return api.removeTagsFromTestCases(client, projectId, testCaseIds, tagIds);
    },
    add_test_case_external_links_bulk: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      const testCaseIds = getBulkIdList(args, "testCaseId", "testCaseIds", "test case");
      const links = normalizeBulkExternalLinks(args);
      return api.addExternalLinksToTestCases(client, projectId, testCaseIds, links);
    },
    get_test_case_overview: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestCaseOverview(client, getRequiredId(args, "testCaseId"));
    },
    get_test_case_history: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestCaseHistory(client, getRequiredId(args), pickPagination(args));
    },
    get_test_case_scenario: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestCaseScenario(client, getRequiredId(args));
    },
    get_test_case_tags: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestCaseTags(client, getRequiredId(args, "testCaseId"));
    },
    set_test_case_tags: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.setTestCaseTags(client, getRequiredId(args, "testCaseId"), args.payload);
    },
    get_test_case_issues: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestCaseIssues(client, getRequiredId(args, "testCaseId"));
    },
    set_test_case_issues: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.setTestCaseIssues(client, getRequiredId(args, "testCaseId"), args.payload);
    },
    restore_test_case: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.restoreTestCase(client, getRequiredId(args));
    },
    list_project_custom_fields: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.listProjectCustomFields(client, projectId, {
        query: getOptionalString(args, "query"),
        ...pickPagination(args),
      });
    },
    list_custom_field_values: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.listCustomFieldValues(
        client,
        projectId,
        getRequiredId(args, "customFieldId"),
        {
        query: getOptionalString(args, "query"),
        global: getOptionalBoolean(args, "global"),
        testCaseSearch: getOptionalString(args, "testCaseSearch"),
        ...pickPagination(args),
        },
      );
    },
    get_test_case_custom_fields: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getTestCaseCustomFields(client, getRequiredId(args, "testCaseId"), projectId);
    },
    set_test_case_custom_fields: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      const testCaseId = getRequiredId(args, "testCaseId");
      return api.setTestCaseCustomFields(client, projectId, testCaseId, args.payload);
    },
    remove_test_case_custom_fields: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      const testCaseIds = getBulkIdList(args, "testCaseId", "testCaseIds", "test case");
      const customFieldIds = getBulkIdList(args, "customFieldId", "customFieldIds", "custom field");
      return api.removeCustomFieldsFromTestCases(client, projectId, testCaseIds, customFieldIds);
    },
    bulk_set_test_case_custom_fields: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      const testCaseIds = getBulkIdList(args, "testCaseId", "testCaseIds", "test case");
      const mode = getOptionalString(args, "mode") ?? "replace";

      if (mode === "replace") {
        const fieldIds = extractCustomFieldIds(args.payload);
        if (fieldIds.length > 0) {
          await api.removeCustomFieldsFromTestCases(client, projectId, testCaseIds, fieldIds);
        }
      }

      return api.bulkSetTestCaseCustomFields(client, projectId, testCaseIds, args.payload);
    },
    delete_custom_field_value: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.deleteCustomFieldValue(client, getRequiredId(args, "valueId"));
    },
    rename_custom_field_value: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.renameCustomFieldValue(
        client,
        getRequiredId(args, "valueId"),
        getRequiredString(args, "name"),
      );
    },
    merge_custom_field_values: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      const customFieldId = getRequiredNumber(args, "customFieldId");
      const sourceValueId = getRequiredNumber(args, "sourceValueId");
      const targetValueId = getRequiredNumber(args, "targetValueId");

      const searchResult = await api.searchTestCases(client, projectId, `cf[${customFieldId}] = ${sourceValueId}`, {
        size: 2000,
      }) as { content?: Array<{ id: number }> };

      const testCaseIds = Array.isArray(searchResult?.content)
        ? searchResult.content.map((tc) => tc.id).filter((id): id is number => typeof id === "number")
        : [];

      if (testCaseIds.length > 0) {
        await api.removeCustomFieldsFromTestCases(client, projectId, testCaseIds, [customFieldId]);
        await api.bulkSetTestCaseCustomFields(client, projectId, testCaseIds, [
          { customField: { id: customFieldId }, values: [{ id: targetValueId }] },
        ]);
      }

      await api.deleteCustomFieldValue(client, sourceValueId);

      return {
        merged: true,
        testCasesReassigned: testCaseIds.length,
        sourceValueId,
        targetValueId,
        sourceDeleted: true,
      };
    },
    search_test_cases_by_missing_field: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      const fieldName = getRequiredString(args, "fieldName");
      const additionalRql = getOptionalString(args, "additionalRql");

      let rql = `cf["${fieldName}"] is empty`;
      if (additionalRql) {
        rql = `${rql} and ${additionalRql}`;
      }

      return api.searchTestCases(client, projectId, rql, {
        ...pickPagination(args),
      });
    },
    get_test_case_comments: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const testCaseId = getRequiredNumber(args, "testCaseId");
      return api.getTestCaseComments(client, testCaseId, pickPagination(args));
    },
    add_test_case_comment: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const testCaseId = getRequiredNumber(args, "testCaseId");
      const body = getRequiredString(args, "body");
      return api.addTestCaseComment(client, testCaseId, body);
    },
    list_test_case_attachments: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const testCaseId = getRequiredNumber(args, "testCaseId");
      return api.listTestCaseAttachments(client, testCaseId, pickPagination(args));
    },
    upload_test_case_attachments: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const testCaseId = getRequiredNumber(args, "testCaseId");
      const filesRaw = args.files;
      if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
        throw new Error("\"files\" must be a non-empty array.");
      }
      const files: api.AttachmentUploadInput[] = filesRaw.map((entry, idx) => {
        if (!entry || typeof entry !== "object") {
          throw new Error(`"files[${idx}]" must be an object.`);
        }
        const obj = entry as Record<string, unknown>;
        const file: api.AttachmentUploadInput = {};
        if (typeof obj.path === "string") file.path = obj.path;
        if (typeof obj.base64 === "string") file.base64 = obj.base64;
        if (typeof obj.name === "string") file.name = obj.name;
        if (typeof obj.mimeType === "string") file.mimeType = obj.mimeType;
        if (!file.path && !file.base64) {
          throw new Error(`"files[${idx}]" must include either "path" or "base64".`);
        }
        return file;
      });
      return api.uploadTestCaseAttachments(client, testCaseId, files);
    },
    download_test_case_attachment_content: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const attachmentId = getRequiredNumber(args, "attachmentId");
      const savePath = getOptionalString(args, "savePath");
      return api.downloadTestCaseAttachmentContent(client, attachmentId, {
        ...(savePath !== undefined ? { savePath } : {}),
      });
    },
    delete_test_case_comment: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const commentId = getRequiredNumber(args, "commentId");
      return api.deleteTestCaseComment(client, commentId);
    },
    add_test_case_step: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const testCaseId = getRequiredNumber(args, "testCaseId");
      const afterId = getOptionalNumber(args, "afterId");
      const withExpectedResult = getOptionalBoolean(args, "withExpectedResult");
      const explicitBodyJson = args.bodyJson;
      const plainBody = getOptionalString(args, "body");

      let bodyJson: unknown;
      if (explicitBodyJson !== undefined) {
        if (!explicitBodyJson || typeof explicitBodyJson !== "object" || Array.isArray(explicitBodyJson)) {
          throw new Error("\"bodyJson\" must be an object (ProseMirror doc).");
        }
        bodyJson = explicitBodyJson;
      } else if (plainBody !== undefined) {
        bodyJson = api.buildPlainTextBodyJson(plainBody);
      } else {
        throw new Error("Either \"body\" or \"bodyJson\" must be provided.");
      }

      return api.addTestCaseStep(
        client,
        { testCaseId, bodyJson },
        {
          ...(afterId !== undefined ? { afterId } : {}),
          ...(withExpectedResult !== undefined ? { withExpectedResult } : {}),
        },
      );
    },
  };

  return { tools, handlers };
}
