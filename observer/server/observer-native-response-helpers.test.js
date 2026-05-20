import assert from "node:assert/strict";
import test from "node:test";

import { createObserverNativeResponseHelpers } from "./observer-native-response-helpers.js";

function createTodoHelper(overrides = {}) {
  const todoItems = [];
  const helper = createObserverNativeResponseHelpers({
    PROMPT_USER_PATH: "",
    addTodoItem: async ({ text, createdBy = "user", source = "native" } = {}) => {
      const item = {
        id: `todo-${todoItems.length + 1}`,
        text: String(text || "").trim(),
        createdBy,
        source,
        status: "open"
      };
      todoItems.push(item);
      return item;
    },
    buildTodoSummaryLines: async () => [`${todoItems.length} open item${todoItems.length === 1 ? "" : "s"} in the backlog.`],
    findTodoItemByReference: async () => null,
    listTodoItems: async () => ({ items: todoItems, open: todoItems, completed: [] }),
    normalizeTodoReference: (value = "") => String(value || "").trim().replace(/[.?!]+$/g, "").trim(),
    parseDirectMailRequest: () => null,
    parseStandingMailWatchRequest: () => null,
    removeTodoItem: async () => null,
    setTodoItemStatus: async () => null,
    ...overrides
  });
  return { helper, todoItems };
}

test("todo add intent with missing item text asks for clarification instead of summarizing", async () => {
  const { helper, todoItems } = createTodoHelper();

  const response = await helper.tryHandleTodoRequest("Please add a new to do list item and explain it");

  assert.equal(response.type, "todo_add_missing_text");
  assert.equal(response.text, "What should I add to your to do list?");
  assert.equal(todoItems.length, 0);
});

test("todo add item with explicit item text records the item", async () => {
  const { helper, todoItems } = createTodoHelper();

  const response = await helper.tryHandleTodoRequest("Please add a new to do list item: explain the intake regression");

  assert.equal(response.type, "todo_add");
  assert.equal(todoItems.length, 1);
  assert.equal(todoItems[0].text, "explain the intake regression");
});

test("knock knock opener gets a conversational response", async () => {
  const { helper } = createTodoHelper();

  const response = await helper.tryBuildObserverNativeResponse("knock knock");

  assert.equal(response.type, "conversation");
  assert.equal(response.text, "Who's there?");
});

test("knock knock setup uses recent conversation", async () => {
  const { helper } = createTodoHelper();

  const response = await helper.tryBuildObserverNativeResponse("Orange", {
    recentExchanges: [
      { role: "user", text: "knock knock" },
      { role: "agent", text: "Who's there?" }
    ]
  });

  assert.equal(response.type, "conversation");
  assert.equal(response.text, "Orange who?");
});

test("casual wellbeing question stays conversational", async () => {
  const { helper } = createTodoHelper();

  const response = await helper.tryBuildObserverNativeResponse("how are you doing");

  assert.equal(response.type, "conversation");
  assert.match(response.text, /doing okay/i);
});

test("help request includes visible command list instead of heading only", async () => {
  const { helper } = createTodoHelper({
    isHelpRequest: (message = "") => String(message || "").trim().toLowerCase() === "list commands",
    buildToolConfigPayload: async () => ({
      tools: [
        { name: "get_queue_status", approved: true, scopes: ["intake"], source: "core" },
        { name: "sprint_create", approved: true, scopes: ["worker"], source: "plugin", pluginId: "sprint", pluginName: "Sprint" },
        { name: "sprint_advance", approved: true, scopes: ["worker"], source: "plugin", pluginId: "sprint", pluginName: "Sprint" }
      ]
    })
  });

  const response = await helper.tryBuildObserverNativeResponse("list commands");

  assert.equal(response.type, "help");
  assert.match(response.text, /Here is what I can help you with:/);
  assert.match(response.text, /queue status/i);
  assert.match(response.text, /create a sprint/i);
  assert.notEqual(response.text.trim(), "Here is what I can help you with:");
});
