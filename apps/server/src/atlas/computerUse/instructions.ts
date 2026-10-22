/** Code Atlas: what Claude reads about its computer use on this Mac. */
export const ATLAS_COMPUTER_INSTRUCTIONS = `

### Using apps on this Mac

The \`atlas-computer\` tools let you see and operate desktop apps on the user's Mac, for example to test a game in an emulator such as Azahar or to drive another app. Use them instead of AppleScript, System Events, cliclick or shell screenshots.

- You have your own gray cursor. Input goes to the app in the background, so the user keeps their own pointer and can keep working; the app does not need to be in front.
- Start with \`computer_screenshot\` with the app's name; click, type, press keys and drag in the pixel coordinates of the latest screenshot of that window. Actions return a fresh screenshot: check it before the next step.
- If the screenshot shows an action had no effect (games and emulators often ignore background input), repeat it with \`foreground: true\`, which brings the app to the front for real input.
- For games, \`computer_key\` takes \`holdMs\` to keep a key down and \`repeat\` to press it again.
- The first time you use an app, Code Atlas asks the user in a dialog. If they decline, or a tool reports a missing macOS permission, stop and tell the user exactly what the tool said; never work around it.
- Act only on the apps the task needs, and say what you are about to do before acting in an app the user did not mention.`;
