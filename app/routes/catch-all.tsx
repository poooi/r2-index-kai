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

// export const generateMetadata = async ({
//   params: { path = [] },
// }: {
//   params: { path?: string[] }
// }): Promise<Metadata> => {
//   const host = headers().get('host')

//   const cfContext = await getCloudflareContext()

//   const site = getSite(cfContext.env, host!)
//   return {
//     title: `index of /${path.join('/')} | ${site.title}`,
//     description: site.description,
//   }
// }

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

  const { "*": splats = "" } = params;

  console.log(splats)

  let result: FileListing[] = [];

  const cached = await cfContext.env.NEXT_CACHE_WORKERS_KV.get<string>(
    getBucketDataCacheKey(splats, host)
  );

  if (cached !== null) {
    result = JSON.parse(cached) as FileListing[];
  } else {
    const listResult = await listBucket(site.bucket, {
      prefix: splats,
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

  return { data: result, splats, siteTitle: site.title, siteHost: host };
};

export default async function CatchAll({ loaderData }: Route.ComponentProps) {
  const { data, splats, siteTitle, siteHost } = loaderData;

  const path = splats.split("/");

  return (
    <main className="relative flex min-h-screen max-w-screen-2xl flex-col p-4">
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
        {import.meta.env.COMMIT_HASH && (
          <>
            <span> | </span>
            <span>
              poi R2 index version {import.meta.env.COMMIT_HASH.slice(0, 8)}/
              {import.meta.env.BUILD_DATE}
            </span>
          </>
        )}
      </footer>
    </main>
  );
}
