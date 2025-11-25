# HiveMind slash commands

The chat box accepts a few lightweight commands to control EMU context without leaving the UI.

- `/emus` – refresh the backend EMU list and print what is mounted vs. available.
- `/mount <emu-id>` – mount an EMU by id (for example `poetry`).
- `/unmount <emu-id>` – unmount an EMU by id.
- `/reset` – clear the chat history and router state.

Commands are processed locally in the browser; messages that do not start with `/` are routed to the backend for intent detection and retrieval.
