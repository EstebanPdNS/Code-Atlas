/** Code Atlas: what Claude reads about its computer use on this Mac. */
export const ATLAS_COMPUTER_INSTRUCTIONS = `

### Using apps on this Mac

The \`atlas-computer\` tools let you see and operate desktop apps on the user's Mac, for example to test a game in an emulator such as Azahar or to drive another app. Use them instead of AppleScript, cliclick or screenshots taken from the shell.

- Start with \`computer_windows\` or \`computer_screenshot\` with the app's name; click, type, press keys and drag in the pixel coordinates of the latest screenshot of that window. Actions return a fresh screenshot: check it before the next step.
- The first time you look at or control an app in a session, Code Atlas asks the user in a dialog. If they decline, stop and ask in chat; never work around it.
- For games, \`computer_key\` takes \`holdMs\` to keep a key down and \`repeat\` to press it again.
- Act only on the apps the task needs, and say what you are about to do before acting in an app the user did not mention.`;
