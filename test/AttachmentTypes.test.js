const { loadCoreGas } = require("./helpers/testSetup");
const { loadGas } = require("./helpers/loadGas");

beforeEach(() => {
  loadCoreGas();
  loadGas("../../src/AttachmentTypes.gs");
});

describe("detectAttachmentType_", () => {
  test("maps known extensions to their attachment type (case-insensitive)", () => {
    expect(detectAttachmentType_("cat.png")).toBe("photo");
    expect(detectAttachmentType_("cat.JPG")).toBe("photo");
    expect(detectAttachmentType_("archive.zip")).toBe("zip");
    expect(detectAttachmentType_("notes.md")).toBe("md_file");
    expect(detectAttachmentType_("report.docx")).toBe("office_doc");
    expect(detectAttachmentType_("sheet.XLSX")).toBe("office_doc");
    expect(detectAttachmentType_("slides.pptx")).toBe("office_doc");
    expect(detectAttachmentType_("doc.pdf")).toBe("pdf");
    expect(detectAttachmentType_("doc.odt")).toBe("odf_doc");
  });

  test("defaults to 'code' for unknown extensions and files with no extension", () => {
    expect(detectAttachmentType_("script.py")).toBe("code");
    expect(detectAttachmentType_("query.sql")).toBe("code");
    expect(detectAttachmentType_("weird.xyz")).toBe("code");
    expect(detectAttachmentType_("README")).toBe("code");
  });
});

describe("resolveUploadContentType_", () => {
  test("maps known-safe extensions to a fixed Content-Type (case-insensitive)", () => {
    expect(resolveUploadContentType_("cat.png")).toBe("image/png");
    expect(resolveUploadContentType_("cat.JPG")).toBe("image/jpeg");
    expect(resolveUploadContentType_("archive.zip")).toBe("application/zip");
    expect(resolveUploadContentType_("notes.md")).toBe("text/markdown");
    expect(resolveUploadContentType_("doc.pdf")).toBe("application/pdf");
    expect(resolveUploadContentType_("report.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });

  test("forces application/octet-stream for svg, even though detectAttachmentType_ classifies it as photo", () => {
    // svg 是可以帶 <script> 的 XML 文件,不是單純的點陣圖——不能比照其他圖片
    // 副檔名直接信任成 image/svg+xml,否則簽名連結被直接開啟時瀏覽器可能會
    // 把內嵌的 script 當文件內容執行。
    expect(resolveUploadContentType_("logo.svg")).toBe("application/octet-stream");
  });

  test("forces application/octet-stream for unknown/code extensions (e.g. html, js) and files with no extension", () => {
    expect(resolveUploadContentType_("page.html")).toBe("application/octet-stream");
    expect(resolveUploadContentType_("script.js")).toBe("application/octet-stream");
    expect(resolveUploadContentType_("weird.xyz")).toBe("application/octet-stream");
    expect(resolveUploadContentType_("README")).toBe("application/octet-stream");
  });
});
