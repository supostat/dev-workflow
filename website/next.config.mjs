import { createMDX } from "fumadocs-mdx/next";

const isGithubPages = process.env.GITHUB_ACTIONS === "true";

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: "export",
  basePath: isGithubPages ? "/dev-workflow" : "",
};

const withMDX = createMDX();

export default withMDX(config);
