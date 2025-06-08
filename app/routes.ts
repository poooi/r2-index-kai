import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  layout("./components/layout.tsx", [
    index("./routes/index.tsx"),
    route("/*", "./routes/catch-all.tsx"),
  ]),
] satisfies RouteConfig;
