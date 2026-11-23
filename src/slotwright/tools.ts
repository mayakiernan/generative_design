/**
 * The agent's tools, run against a host that holds build.mjs and can validate, render and finalize it: the command
 * line's record (child processes) or Slot Studio's page (a Web Worker). Same arguments, same replies, so the model
 * sees the same thing in both. No Node or DOM APIs here.
 */
import {z} from 'zod';
import {numbered} from './template.js';
import {reportText, type ValidationReport} from './validate.js';

export const ReadArgs = z.object({from: z.number().int().min(1).optional(), to: z.number().int().min(1).optional()});
export const WriteArgs = z.object({content: z.string().min(1)});
export const EditArgs = z.object({old_str: z.string().min(1), new_str: z.string(), replace_all: z.boolean().optional()});
export const ValidateArgs = z.object({});
export const RenderArgs = z.object({azimuth: z.number().min(-360).max(360).optional(), elevation: z.number().min(-90).max(90).optional(), look: z.enum(['pieces', 'plain']).optional()});
export const FinalizeArgs = z.object({summary: z.string().min(1).max(800)});
export type RenderOpts = z.infer<typeof RenderArgs>;

export interface ToolHost {
  read(): string;
  write(source: string): void;
  validate(): Promise<ValidationReport>;
  /** A PNG as base64 and a sentence on what it shows, or why it failed. */
  render(o: RenderOpts): Promise<{ok: boolean; png?: string; views?: string; error?: string}>;
  /** Finish, if the current source validated ok; `text` says what was written. */
  finalize(summary: string): Promise<{ok: boolean; text?: string; error?: string}>;
}

export type ToolContent = string | ({type: 'text'; text: string} | {type: 'image'; source: {type: 'base64'; media_type: 'image/png'; data: string}})[];
export interface ToolReply {content: ToolContent; isError?: boolean; report?: ValidationReport; png?: string; done?: boolean}

export async function runTool(name: string, input: unknown, host: ToolHost): Promise<ToolReply> {
  const bad = (e: z.ZodError): ToolReply => ({content: `Invalid input: ${e.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`, isError: true});
  const args = input ?? {};
  switch (name) {
    case 'read_build': {
      const a = ReadArgs.safeParse(args); if (!a.success) return bad(a.error);
      return {content: numbered(host.read(), a.data.from, a.data.to)};
    }
    case 'write_build': {
      const a = WriteArgs.safeParse(args); if (!a.success) return bad(a.error);
      host.write(a.data.content);
      return {content: `ok: build.mjs written (${a.data.content.split('\n').length} lines)`};
    }
    case 'edit_build': {
      const a = EditArgs.safeParse(args); if (!a.success) return bad(a.error);
      const src = host.read(), n = src.split(a.data.old_str).length - 1;
      if (!n) return {content: 'edit failed: old_str does not occur in build.mjs (read_build to see the current text)', isError: true};
      if (n > 1 && !a.data.replace_all) return {content: `edit failed: old_str occurs ${n} times; add context to make it unique, or set replace_all`, isError: true};
      const at = src.indexOf(a.data.old_str), next = a.data.replace_all ? src.split(a.data.old_str).join(a.data.new_str) : src.replace(a.data.old_str, () => a.data.new_str);
      host.write(next);
      const line = src.slice(0, at).split('\n').length, span = a.data.new_str.split('\n').length;
      return {content: `ok: edited${a.data.replace_all ? ` ${n} places` : ''}. Region now:\n${numbered(next, Math.max(1, line - 2), line + span + 2)}`};
    }
    case 'validate': {
      const report = await host.validate();
      return {content: reportText(report), report};
    }
    case 'render': {
      const a = RenderArgs.safeParse(args); if (!a.success) return bad(a.error);
      const r = await host.render(a.data);
      if (!r.ok || !r.png) return {content: `render failed:\n${r.error}`, isError: true};
      return {content: [{type: 'text', text: `Rendered ${r.views}`}, {type: 'image', source: {type: 'base64', media_type: 'image/png', data: r.png}}], png: r.png};
    }
    case 'finalize': {
      const a = FinalizeArgs.safeParse(args); if (!a.success) return bad(a.error);
      const r = await host.finalize(a.data.summary);
      if (!r.ok) return {content: `finalize refused: ${r.error}`, isError: true};
      return {content: `Finalized. ${r.text ?? ''}`.trim(), done: true};
    }
    default:
      return {content: `Unknown tool ${name}.`, isError: true};
  }
}
