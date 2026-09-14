import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import type { CustomerEnv } from "./customer.ts";
import { type CustomerServices, moduleFail } from "./customer-modules.ts";
import {
  preservationDetails,
  enqueuePreservation,
} from "./customer-preservation.ts";
import { resolveCustomerFile, customerFileResponse } from "./customer-files.ts";
import { twitterPost } from "./customer-twitter.ts";
import { config } from "./config.ts";
export function registerPreservation(
  app: Hono<CustomerEnv>,
  db: Database,
  services: CustomerServices,
) {
  app.on(
    "GET",
    ["/captures/:id/preservation", "/mobile/captures/:id/preservation"],
    (c) => {
      const owner = services.auth(c).account.id,
        id = c.req.param("id");
      if (
        !db
          .query("SELECT 1 FROM customer_captures WHERE id=? AND account_id=?")
          .get(id, owner)
      )
        moduleFail(404, "not_found", "Saved item not found.");
      return c.json({ preservation: preservationDetails(db, owner, id) });
    },
  );
  app.on(
    "POST",
    ["/captures/:id/preservation", "/mobile/captures/:id/preservation"],
    async (c) => {
      const owner = services.auth(c).account.id,
        id = c.req.param("id");
      services.rate("preserve:" + owner, 20, 60_000);
      const body = await services.jsonBody(c);
      if (Object.keys(body).length)
        moduleFail(400, "invalid_input", "This action takes no options.");
      db.transaction(() => {
        services.auth(c);
        const row = db
          .query(
            "SELECT source_url FROM customer_captures WHERE id=? AND account_id=?",
          )
          .get(id, owner) as { source_url: string | null } | null;
        if (!row) moduleFail(404, "not_found", "Saved item not found.");
        if (!twitterPost(row.source_url))
          moduleFail(400, "unsupported_source", "Use an X post permalink.");
        const previous = db
          .query(
            "SELECT source_url FROM customer_preservation_jobs WHERE capture_id=? AND account_id=?",
          )
          .get(id, owner) as { source_url: string } | null;
        if (
          previous &&
          previous.source_url !== twitterPost(row.source_url)!.url
        )
          moduleFail(
            409,
            "source_changed",
            "This item now has a different source. Save the new post separately to keep its files.",
          );
        enqueuePreservation(db, owner, id, row.source_url);
        db.query(
          "UPDATE customer_preservation_jobs SET status='pending',attempts=0,error=NULL,next_attempt_at=0,updated_at=? WHERE capture_id=? AND account_id=? AND status IN ('partial','failed')",
        ).run(Date.now(), id, owner);
      }).immediate();
      return c.json({ preservation: preservationDetails(db, owner, id) }, 202);
    },
  );
  app.on(
    "GET",
    ["/captures/:id/assets/:asset", "/mobile/captures/:id/assets/:asset"],
    (c) => {
      const owner = services.auth(c, !c.req.path.includes("/mobile/captures/"))
        .account.id;
      const asset = db
        .query(
          "SELECT title,mime,file_path,body_text FROM customer_media_assets WHERE id=? AND capture_id=? AND account_id=?",
        )
        .get(c.req.param("asset")!, c.req.param("id")!, owner) as {
        title: string;
        mime: string;
        file_path: string | null;
        body_text: string | null;
      } | null;
      if (!asset) moduleFail(404, "not_found", "Saved file not found.");
      let response: Response;
      if (asset.file_path) {
        const file = Bun.file(
          resolveCustomerFile(config.dataDir, asset.file_path),
        );
        if (!file.size) moduleFail(404, "not_found", "Saved file not found.");
        response = customerFileResponse(
          file,
          asset.mime,
          asset.title,
          c.req.header("range") || null,
        );
      } else
        response = new Response(asset.body_text || "", {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      if (c.req.query("download") === "1")
        response.headers.set(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(asset.file_path ? asset.title : asset.title + ".txt").replace(/'/g, "%27")}`,
        );
      return response;
    },
  );
}
