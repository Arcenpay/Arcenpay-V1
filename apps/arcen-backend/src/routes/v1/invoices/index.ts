import { Hono } from "hono";
import { GET as invoicesList, POST as invoicesCreate } from "./root.js";
import { GET as invoiceById, PATCH as invoiceUpdate } from "./by-id.js";
import { GET as invoiceDownload } from "./download.js";
import { GET as invoiceIso20022 } from "./iso20022.js";
import { GET as invoicePublicDownload } from "./public-download.js";
import { GET as invoiceCreditNotesList, POST as invoiceCreditNotesCreate } from "./credit-notes.js";
import { GET as invoiceRefundsList, POST as invoiceRefundsCreate } from "./refunds.js";
import { POST as invoiceResend } from "./resend.js";
import {
  activateTemplate as templateActivate,
  createTemplate as templateCreate,
  deleteTemplate as templateDelete,
  duplicateTemplate as templateDuplicate,
  getDefaultConfig as templateDefaultConfig,
  getTemplate as templateById,
  listTemplates as templateList,
  previewTemplate as templatePreview,
  updateTemplate as templateUpdate,
  uploadTemplateLogo as templateUploadLogo,
} from "./templates.js";

export const invoicesRoutes = new Hono()
  .get("/", invoicesList)
  .post("/", invoicesCreate)
  // Invoice builder templates — registered BEFORE /:id catch-alls.
  .get("/templates", templateList)
  .post("/templates", templateCreate)
  .get("/templates/default-config", templateDefaultConfig)
  .post("/templates/logo", templateUploadLogo)
  .post("/templates/preview", templatePreview)
  .get("/templates/:id", templateById)
  .patch("/templates/:id", templateUpdate)
  .delete("/templates/:id", templateDelete)
  .post("/templates/:id/activate", templateActivate)
  .post("/templates/:id/duplicate", templateDuplicate)
  .get("/:id", invoiceById)
  .patch("/:id", invoiceUpdate)
  .get("/:id/download", invoiceDownload)
  .get("/:id/iso20022", invoiceIso20022)
  .get("/public/:id/download", invoicePublicDownload)
  .get("/:id/credit-notes", invoiceCreditNotesList)
  .post("/:id/credit-notes", invoiceCreditNotesCreate)
  .get("/:id/refunds", invoiceRefundsList)
  .post("/:id/refunds", invoiceRefundsCreate)
  .post("/:id/resend", invoiceResend);
