import { Schema } from "effect";

import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { useLocalStorage } from "~/hooks/useLocalStorage";

import { ATLAS_SOUND_STORAGE_KEY, replayAtlasIntro } from "../intro/atlasIntro";

export const ATLAS_BACKGROUND_TASKS_CARD_KEY = "codeatlas:show-background-tasks-card";

/** Whether the thread details column shows the Background tasks (output) card. */
export function useAtlasBackgroundTasksCard() {
  return useLocalStorage(ATLAS_BACKGROUND_TASKS_CARD_KEY, false, Schema.Boolean);
}

/** Settings → General → Code Atlas: per-device preferences for the fork's own surfaces. */
export function AtlasSettingsSection() {
  const [showTasks, setShowTasks] = useAtlasBackgroundTasksCard();
  const [sound, setSound] = useLocalStorage(ATLAS_SOUND_STORAGE_KEY, true, Schema.Boolean);
  return (
    <SettingsSection id="code-atlas" title="Code Atlas">
      <SettingsRow
        title="Background tasks card"
        description="Show agent background work and running terminals beside the thread."
        control={
          <Switch
            checked={showTasks}
            onCheckedChange={setShowTasks}
            aria-label="Background tasks card"
          />
        }
      />
      <SettingsRow
        title="Startup sound"
        description="Play the Aurora cue when the launch intro loads the logo."
        control={<Switch checked={sound} onCheckedChange={setSound} aria-label="Startup sound" />}
      />
      <SettingsRow
        title="Launch intro"
        description="The handbook terminal plays once each time Code Atlas opens."
        control={
          <Button size="sm" variant="outline" onClick={replayAtlasIntro}>
            Replay
          </Button>
        }
      />
    </SettingsSection>
  );
}
