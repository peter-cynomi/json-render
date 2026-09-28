// @vitest-environment node
import { describe, it, expect } from "vitest";
import React from "react";
import { z } from "zod";
import {
  Document,
  Page,
  Text as PdfText,
  View,
  renderToBuffer as pdfRenderToBuffer,
} from "@react-pdf/renderer";
import type { DirectiveDefinition, Spec } from "@json-render/core";
import { defineDirective, resolvePropValue } from "@json-render/core";
import { renderToBuffer } from "./render";
import {
  JSONUIProvider,
  Renderer,
  type ComponentRenderProps,
} from "./renderer";

let drawn: string[] = [];

function Doc({ children }: ComponentRenderProps) {
  return (
    <Document>
      <Page>{children}</Page>
    </Document>
  );
}

function Stack({ children }: ComponentRenderProps) {
  return <View>{children}</View>;
}

function Text({ element }: ComponentRenderProps<{ text: unknown }>) {
  const value = element.props.text;
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  drawn.push(text);
  return <PdfText>{text}</PdfText>;
}

const registry = { Doc, Stack, Text };

const doubleDirective = defineDirective({
  name: "$double",
  schema: z.object({ $double: z.unknown() }),
  resolve(value, ctx) {
    return (resolvePropValue(value.$double, ctx) as number) * 2;
  },
});

const upperDirective = defineDirective({
  name: "$upper",
  schema: z.object({ $upper: z.unknown() }),
  resolve(value, ctx) {
    return String(resolvePropValue(value.$upper, ctx)).toUpperCase();
  },
});

const directives: DirectiveDefinition[] = [doubleDirective, upperDirective];

function docSpec(
  elements: Spec["elements"],
  children: string[],
  state: Record<string, unknown> = {},
): Spec {
  return {
    root: "doc",
    state,
    elements: {
      doc: { type: "Doc", props: {}, children },
      ...elements,
    },
  };
}

async function drawServerWalk(
  spec: Spec,
  withDirectives?: DirectiveDefinition[],
): Promise<string[]> {
  drawn = [];
  await renderToBuffer(spec, {
    registry,
    includeStandard: false,
    directives: withDirectives,
  });
  return drawn;
}

async function drawProviderRenderer(
  spec: Spec,
  withDirectives?: DirectiveDefinition[],
): Promise<string[]> {
  drawn = [];
  await pdfRenderToBuffer(
    <JSONUIProvider initialState={spec.state ?? {}} directives={withDirectives}>
      <Renderer spec={spec} registry={registry} includeStandard={false} />
    </JSONUIProvider>,
  );
  return drawn;
}

describe.each([
  ["renderToBuffer", drawServerWalk],
  ["Renderer", drawProviderRenderer],
])("%s: directives", (_name, draw) => {
  it("resolves a custom directive in props", async () => {
    const spec = docSpec(
      { t: { type: "Text", props: { text: { $upper: "hello" } } } },
      ["t"],
    );
    expect(await draw(spec, directives)).toEqual(["HELLO"]);
  });

  it("resolves directive arguments from $state", async () => {
    const spec = docSpec(
      {
        t: {
          type: "Text",
          props: { text: { $double: { $state: "/count" } } },
        },
      },
      ["t"],
      { count: 21 },
    );
    expect(await draw(spec, directives)).toEqual(["42"]);
  });

  it("composes nested directives", async () => {
    const spec = docSpec(
      {
        t: {
          type: "Text",
          props: { text: { $upper: { $double: 4 } } },
        },
      },
      ["t"],
    );
    expect(await draw(spec, directives)).toEqual(["8"]);
  });

  it("resolves $item inside a directive in a repeat", async () => {
    const spec = docSpec(
      {
        list: {
          type: "Stack",
          props: {},
          repeat: { statePath: "/tasks" },
          children: ["t"],
        },
        t: {
          type: "Text",
          props: { text: { $upper: { $item: "title" } } },
        },
      },
      ["list"],
      { tasks: [{ title: "mfa" }, { title: "patch" }] },
    );
    expect(await draw(spec, directives)).toEqual(["MFA", "PATCH"]);
  });

  it("leaves directives unresolved when none are registered", async () => {
    const spec = docSpec(
      { t: { type: "Text", props: { text: { $upper: "hello" } } } },
      ["t"],
    );
    expect(await draw(spec)).toEqual(['{"$upper":"hello"}']);
  });
});
