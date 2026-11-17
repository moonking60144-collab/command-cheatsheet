// Phosphor duotone symbols are bundled locally for offline use.
export function icon(name) {
  return `<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="assets/icons/ui.svg#${name}"></use></svg>`;
}

export function categoryIcon(category) {
  if (category.startsWith("Windows")) return "windows-logo";
  return {
    all: "books",
    pinned: "star",
    Bash: "terminal",
    Docker: "cube",
    Git: "git-branch",
    GitHub: "github-logo",
    Nmap: "globe-hemisphere-west",
    npm: "package",
    PowerShell: "terminal",
    Python: "code",
    winget: "package"
  }[category] || "terminal";
}
