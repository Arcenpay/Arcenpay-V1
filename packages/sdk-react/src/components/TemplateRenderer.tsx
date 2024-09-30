"use client";

import React from "react";

export type TemplateBlock = {
  type: "heading" | "text" | "price" | "feature-list" | "cta";
  content?: string;
  amount?: string;
  interval?: string;
  items?: string[];
  href?: string;
};

export interface TemplateRendererProps {
  name: string;
  blocks: TemplateBlock[];
  className?: string;
}

/**
 * Renders a billing template from JSON blocks.
 * This powers the internal template library install output.
 */
export function TemplateRenderer({
  name,
  blocks,
  className = "",
}: TemplateRendererProps) {
  return (
    <div
      className={`arcenpay-template-renderer ${className}`}
      data-template-name={name}
    >
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return <h2 key={`${block.type}-${index}`}>{block.content}</h2>;
        }
        if (block.type === "text") {
          return <p key={`${block.type}-${index}`}>{block.content}</p>;
        }
        if (block.type === "price") {
          return (
            <p key={`${block.type}-${index}`}>
              <strong>{block.amount}</strong>
              {block.interval ? <span>{` ${block.interval}`}</span> : null}
            </p>
          );
        }
        if (block.type === "feature-list") {
          return (
            <ul key={`${block.type}-${index}`}>
              {(block.items || []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "cta") {
          return (
            <a key={`${block.type}-${index}`} href={block.href || "#"}>
              {block.content || "Continue"}
            </a>
          );
        }
        return null;
      })}
    </div>
  );
}
