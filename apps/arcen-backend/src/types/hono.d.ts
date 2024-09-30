// Augment Hono Context.json to accept number as status code
import type { Context as HonoContext, Env, Input, BlankSchema, Schema } from "hono";

declare module "hono" {
  interface Context<E extends Env = Env, P extends string = string, I extends Input = Input> {
    json<T, U extends number = number, V extends Record<string, string> = Record<string, string>>(
      object: T,
      status?: U,
      headers?: V,
    ): Response;
  }
}
