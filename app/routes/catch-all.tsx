import type { Route } from "./+types/catch-all";

import { Fragment } from "react";

import { FilterInput } from "@/components/file-listing/filter-input";
import { DataType, type FileListing } from "@/components/file-listing/model";
import { IndexTable } from "@/components/file-listing/table";
import { data, Link } from "react-router";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { getSite } from "@/lib/sites";
import { getBucketDataCacheKey, listBucket } from "@/lib/cf";

export const loader = async ({
  request,
  context,
  params,
}: Route.LoaderArgs) => {
  const host = request.headers.get("host");
  if (!host) {
    throw data(null, { status: 404 });
  }

  const cfContext = await context.cloudflare;
  const site = getSite(cfContext.env, host);

  let { "*": splats = "" } = params;
  if (splats.endsWith("/")) {
    splats = splats.slice(0, -1);
  }
  const prefix = splats ? `${splats}/` : "";

  let result: FileListing[] = [];

  const cached = await cfContext.env.NEXT_CACHE_WORKERS_KV.get<string>(
    getBucketDataCacheKey(splats, host)
  );

  if (cached !== null) {
    result = JSON.parse(cached) as FileListing[];
  } else {
    const listResult = await listBucket(site.bucket, {
      prefix,
      delimiter: "/",
      include: ["httpMetadata", "customMetadata"],
    });

    result = [
      ...listResult.delimitedPrefixes.map((delimitedPrefix) => ({
        key: delimitedPrefix,
        href: `/${delimitedPrefix}`,
        type: DataType.Folder,
      })),
      ...listResult.objects.map((object) => ({
        key: object.key,
        href: `/${object.key}`,
        type: DataType.File,
        size: object.size,
        modified: object.uploaded.getTime(),
      })),
    ] satisfies FileListing[];
    cfContext.ctx.waitUntil(
      cfContext.env.NEXT_CACHE_WORKERS_KV.put(
        getBucketDataCacheKey(splats, host),
        JSON.stringify(result),
        {
          expirationTtl: 60,
        }
      )
    );
  }

  if (result.length === 0) {
    throw data(null, { status: 404 });
  }

  return {
    data: result,
    splats,
    siteTitle: site.title,
    siteHost: host,
    siteDescription: site.description,
  };
};

export function headers() {
  return {
    "X-Poi-Codename": "Asashio",
    "X-Poi-Revision": __COMMIT_HASH__ ?? "development",
    "X-Poi-Build-Date": __BUILD_DATE__,
    "X-Poi-Greetings": "poi?",
  };
}

export default async function CatchAll({ loaderData }: Route.ComponentProps) {
  const { data, splats, siteTitle, siteHost, siteDescription } = loaderData;

  const path = splats.split("/");

  return (
    <main className="relative flex min-h-screen max-w-screen-2xl flex-col p-4">
      <title>{`index of /${splats} | ${siteTitle}`}</title>
      <meta name="description" content={siteDescription} />
      <nav className="rounded border-2 bg-card px-4 py-2 text-xl">
        <h2 className="sr-only">Navigation</h2>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/">{siteHost}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {path.map((segment, index) => (
              <Fragment key={path.slice(0, index + 1).join("/")}>
                <BreadcrumbSeparator />

                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to={`/${path.slice(0, index + 1).join("/")}`}>
                      {segment}
                    </Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </nav>
      <h1 className="my-8 text-2xl leading-loose">{siteTitle}</h1>
      <section className="grow">
        <FilterInput />
        <IndexTable data={data} />
      </section>
      <footer className="mt-16">
        <span>{`© ${new Date().getFullYear()} poi Contributors`}</span>
        {__COMMIT_HASH__ && (
          <>
            <span> | </span>
            <span>
              poi R2 index version {__COMMIT_HASH__.slice(0, 8)}/
              {__BUILD_DATE__}
            </span>
          </>
        )}
      </footer>
    </main>
  );
}
