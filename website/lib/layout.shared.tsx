import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "dev-workflow",
    },
    links: [
      {
        text: "GitHub",
        url: "https://github.com/pug-/dev-workflow",
      },
    ],
  };
}
