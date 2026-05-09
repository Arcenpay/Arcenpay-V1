import { Hono } from "hono";
import { GET as invoicesList, POST as invoicesCreate } from "./root.js";
import { GET as invoiceById, PATCH as invoiceUpdate } from "./by-id.js";
import { GET as invoiceDownload } from "./download.js";
import { GET as invoicePublicDownload } from "./public-download.js";
import { GET as invoiceCreditNotesList, POST as invoiceCreditNotesCreate } from "./credit-notes.js";
import { GET as invoiceRefundsList, POST as invoiceRefundsCreate } from "./refunds.js";
import { POST as invoiceResend } from "./resend.js";

export const invoicesRoutes = new Hono()
  .get("/", invoicesList)
  .post("/", invoicesCreate)
  .get("/:id", invoiceById)
  .patch("/:id", invoiceUpdate)
  .get("/:id/download", invoiceDownload)
  .get("/public/:id/download", invoicePublicDownload)
  .get("/:id/credit-notes", invoiceCreditNotesList)
  .post("/:id/credit-notes", invoiceCreditNotesCreate)
  .get("/:id/refunds", invoiceRefundsList)
  .post("/:id/refunds", invoiceRefundsCreate)
  .post("/:id/resend", invoiceResend);
