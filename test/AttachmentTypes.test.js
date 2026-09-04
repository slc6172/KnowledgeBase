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
