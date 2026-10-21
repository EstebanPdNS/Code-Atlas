import { Star } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import type { BrowserSiteInput } from "./browserSites";
import { useBrowserSitesStore, useIsFavoriteSite } from "./browserSitesStore";

/** The star beside the address bar: filled while the page is a favorite. */
export function FavoriteSiteButton(props: { readonly site: BrowserSiteInput }) {
  const favorite = useIsFavoriteSite(props.site.url);
  const label = favorite ? "Remove from Favorites" : "Add to Favorites";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => useBrowserSitesStore.getState().toggleFavorite(props.site)}
            aria-label={label}
            aria-pressed={favorite ? "true" : "false"}
            type="button"
          />
        }
      >
        <Star data-atlas-favorite-star data-on={favorite ? "" : undefined} />
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
