import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { X } from "lucide-react";

import { useFaviconForThreadUrl } from "~/browserFaviconStore";
import { FaviconImage } from "~/components/preview/PreviewFaviconIcon";
import { PreviewLocalServerCard } from "~/components/preview/PreviewLocalServerCard";
import { useDiscoveredLocalServers } from "~/components/preview/useDiscoveredLocalServers";
import { DiscoveryList } from "~/components/ui/discovery-list";

import { type BrowserSite, siteFaviconFallbackUrl, siteInitial, siteLabel } from "./browserSites";
import { useBrowserSitesStore } from "./browserSitesStore";

interface Props {
  readonly threadRef: ScopedThreadRef;
  readonly environmentId: EnvironmentId;
  readonly configuredUrls?: ReadonlyArray<string> | undefined;
  readonly onOpenUrl: (url: string) => void;
}

/**
 * What a new or blank browser tab shows in place of the page, like Codex's
 * new tab: Recents, then Favorites, then any live local servers.
 */
export function BrowserNewTabPage({ threadRef, environmentId, configuredUrls, onOpenUrl }: Props) {
  const recents = useBrowserSitesStore((state) => state.recents);
  const favorites = useBrowserSitesStore((state) => state.favorites);
  const servers = useDiscoveredLocalServers({ environmentId, configuredUrls });
  const removeRecent = useBrowserSitesStore((state) => state.removeRecent);
  const removeFavorite = useBrowserSitesStore((state) => state.removeFavorite);

  return (
    <div data-atlas-newtab className="h-full min-h-0 overflow-y-auto">
      <div data-atlas-newtab-body>
        <SiteSection
          title="Recents"
          hint="Pages you open show up here."
          sites={recents}
          removeLabel="Recents"
          threadRef={threadRef}
          onOpen={onOpenUrl}
          onRemove={removeRecent}
        />
        <SiteSection
          title="Favorites"
          hint="Star a page beside the address bar to keep it here."
          sites={favorites}
          removeLabel="Favorites"
          threadRef={threadRef}
          onOpen={onOpenUrl}
          onRemove={removeFavorite}
        />
        {servers.length > 0 ? (
          <section data-atlas-newtab-section>
            <h2 data-atlas-newtab-heading>Local servers</h2>
            <DiscoveryList>
              {servers.map((server) => (
                <PreviewLocalServerCard
                  key={`${server.host}:${server.port}`}
                  threadRef={threadRef}
                  server={server}
                  onOpen={() => onOpenUrl(server.requestedUrl)}
                />
              ))}
            </DiscoveryList>
            <p data-atlas-newtab-hint>Select a live local server to open it in this browser tab.</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function SiteSection(props: {
  readonly title: string;
  readonly hint: string;
  readonly sites: ReadonlyArray<BrowserSite>;
  readonly removeLabel: string;
  readonly threadRef: ScopedThreadRef;
  readonly onOpen: (url: string) => void;
  readonly onRemove: (url: string) => void;
}) {
  return (
    <section data-atlas-newtab-section>
      <h2 data-atlas-newtab-heading>{props.title}</h2>
      {props.sites.length > 0 ? (
        <ul data-atlas-site-grid>
          {props.sites.map((site) => (
            <SiteTile
              key={site.url}
              site={site}
              removeLabel={props.removeLabel}
              threadRef={props.threadRef}
              onOpen={props.onOpen}
              onRemove={props.onRemove}
            />
          ))}
        </ul>
      ) : (
        <p data-atlas-newtab-hint>{props.hint}</p>
      )}
    </section>
  );
}

function SiteTile(props: {
  readonly site: BrowserSite;
  readonly removeLabel: string;
  readonly threadRef: ScopedThreadRef;
  readonly onOpen: (url: string) => void;
  readonly onRemove: (url: string) => void;
}) {
  const { site } = props;
  const captured = useFaviconForThreadUrl(props.threadRef, site.url);
  const label = siteLabel(site);
  return (
    <li data-atlas-site-tile>
      <button type="button" data-atlas-site-open onClick={() => props.onOpen(site.url)}>
        <span data-atlas-site-icon aria-hidden="true">
          <FaviconImage
            sources={[captured, site.favicon, siteFaviconFallbackUrl(site.url)]}
            fallback={<span data-atlas-site-letter>{siteInitial(site.url)}</span>}
          />
        </span>
        <span data-atlas-site-title>{label}</span>
      </button>
      <button
        type="button"
        data-atlas-site-remove
        aria-label={`Remove ${label} from ${props.removeLabel}`}
        onClick={() => props.onRemove(site.url)}
      >
        <X />
      </button>
    </li>
  );
}
