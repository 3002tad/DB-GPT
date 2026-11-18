import i18n from "@/app/i18n";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SpaceForm from "./space-form";

const api = vi.hoisted(() => ({
  space: vi.fn(),
  document: vi.fn(),
  sync: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/router", () => ({ useRouter: () => ({ push: api.push }) }));
vi.mock("@/components/knowledge/source/binding-wizard", () => ({
  BindingWizard: () => null,
}));
vi.mock("@/client/api", () => ({
  apiInterceptors: async (request: Promise<any>) => {
    try {
      const response = await request;
      return [null, response.data, response];
    } catch (error) {
      return [error, null, null];
    }
  },
  addSpace: (...args: unknown[]) => api.space(...args),
  addDocument: (...args: unknown[]) => api.document(...args),
  syncBatchDocument: (...args: unknown[]) => api.sync(...args),
  getChunkStrategies: async () => ({ success: true, data: [] }),
  getUsableModels: async () => ({ success: true, data: [] }),
  getSpaceList: vi.fn(),
  syncGitRepo: vi.fn(),
  uploadDocument: vi.fn(),
}));

beforeEach(async () => {
  vi.resetAllMocks();
  api.space.mockResolvedValue({ success: true, data: [] });
  api.document.mockResolvedValue({ success: true, data: 42 });
  api.sync.mockResolvedValue({ success: true, data: { tasks: [42] } });
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: () => "",
    overflow: "visible",
    overflowX: "visible",
    overflowY: "visible",
  } as unknown as CSSStyleDeclaration);
  await i18n.changeLanguage("vi");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const content = "Tri thức đã duyệt\nGiữ nguyên nguồn và phiên bản — 原始";
function fillForm() {
  const finish = vi.fn();
  const success = vi.fn();
  const view = render(
    <SpaceForm
      handleStepChange={finish}
      onSuccess={success}
      onCancel={vi.fn()}
      spaceConfig={[{ name: "VectorStore", desc: "Vector", domain_types: [] }]}
    />,
  );
  fireEvent.change(screen.getByLabelText("Tên kho tri thức"), {
    target: { value: "Inline_fixture" },
  });
  fireEvent.change(screen.getByLabelText("Mô tả"), {
    target: { value: "Fixture knowledge" },
  });
  fireEvent.click(screen.getByText("Văn bản"));
  fireEvent.change(screen.getByLabelText("Văn bản"), {
    target: { value: content },
  });
  return {
    ...view,
    finish,
    success,
    submit: () => fireEvent.submit(view.container.querySelector("form")!),
  };
}

it("creates and syncs the entered text directly, without forwarding to the legacy wizard", async () => {
  const view = fillForm();
  fireEvent.click(screen.getByText(i18n.t("Advanced_Settings")));
  fireEvent.change(screen.getByPlaceholderText("512"), {
    target: { value: "1024" },
  });
  fireEvent.change(screen.getByPlaceholderText("50"), {
    target: { value: "0" },
  });
  view.submit();
  await waitFor(() =>
    expect(view.finish).toHaveBeenCalledWith({ label: "finish" }),
  );
  expect(view.finish).toHaveBeenCalledTimes(1);
  expect(api.space).toHaveBeenCalledTimes(1);
  expect(api.document).toHaveBeenCalledWith("Inline_fixture", {
    doc_name: "Inline_fixture",
    doc_type: "TEXT",
    content,
  });
  expect(api.sync).toHaveBeenCalledWith("Inline_fixture", [
    {
      doc_id: 42,
      name: "Inline_fixture",
      chunk_parameters: {
        chunk_strategy: "Automatic",
        chunk_size: 1024,
        chunk_overlap: 0,
      },
    },
  ]);
  expect(api.push).toHaveBeenCalledWith(
    "/construct/knowledge/detail?spaceName=Inline_fixture",
  );
});

it("retains entered content and the created space when adding the document fails", async () => {
  api.document.mockResolvedValueOnce({ success: false, data: null });
  const view = fillForm();
  view.submit();
  await waitFor(() => expect(api.document).toHaveBeenCalledTimes(1));
  expect(view.finish).not.toHaveBeenCalled();
  expect(api.sync).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Văn bản") as HTMLTextAreaElement).value).toBe(
    content,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Tạo và đồng bộ" }).className,
    ).not.toContain("loading"),
  );
  view.submit();
  await waitFor(() => expect(view.success).toHaveBeenCalledTimes(1));
  expect(api.space).toHaveBeenCalledTimes(1);
  expect(api.document).toHaveBeenCalledTimes(2);
  expect(api.document.mock.calls[1]).toEqual(api.document.mock.calls[0]);
});

it.each(["transport", "business"])(
  "retries only synchronization after a %s failure, with no duplicate space/document",
  async (kind) => {
    if (kind === "transport")
      api.sync.mockRejectedValueOnce(new Error("Fixture outage"));
    else api.sync.mockResolvedValueOnce({ success: false, data: null });
    const view = fillForm();
    view.submit();
    await waitFor(() => expect(api.sync).toHaveBeenCalledTimes(1));
    expect(view.finish).not.toHaveBeenCalled();
    expect(api.push).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText("Văn bản") as HTMLTextAreaElement).disabled,
    ).toBe(true);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Tạo và đồng bộ" }).className,
      ).not.toContain("loading"),
    );
    view.submit();
    await waitFor(() =>
      expect(view.finish).toHaveBeenCalledWith({ label: "finish" }),
    );
    expect(api.space).toHaveBeenCalledTimes(1);
    expect(api.document).toHaveBeenCalledTimes(1);
    expect(api.sync).toHaveBeenCalledTimes(2);
    expect(api.sync.mock.calls[1]).toEqual(api.sync.mock.calls[0]);
  },
);
