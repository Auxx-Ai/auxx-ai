<!-- packages/sdk/DEVELOPMENT.md -->

# SDK Development Guide

This guide covers local SDK development and testing workflows.

## Available Scripts

| Script | npm Alias | Description |
|--------|-----------|-------------|
| `./debug-link.sh` | `pnpm debug:link` | Create test app with linked SDK (using file: protocol) |
| `./refresh-link.sh` | `pnpm debug:rebuild` | Rebuild SDK (changes reflected in linked apps) |
| `./debug-init.sh` | `pnpm debug:tarball` | Create test app with tarball install (for pre-publish testing) |

## Two Testing Approaches

### 1. **File Protocol Link** (Recommended for Active Development)

Use `file:` protocol installation when actively developing the SDK and need fast iteration cycles.

**Advantages:**
- Fast: No need to rebuild tarball on every change
- Simple refresh: Just run `./refresh-link.sh` to rebuild
- Live updates: Changes reflect immediately after rebuild
- Symlink-based: Points directly to your local SDK

**Disadvantages:**
- Less accurate representation of installed package (but close)
- Requires SDK to be built before changes are visible

**Workflow:**

```bash
# Initial setup (once)
cd packages/sdk
./debug-link.sh
# Or: pnpm debug:link

# This will:
# 1. Build the SDK
# 2. Create a test app in /tmp/auxx-test-*
# 3. Install SDK using file: protocol (creates symlink)
```

**Making changes:**

```bash
# Edit SDK source files
vim packages/sdk/src/root/index.ts

# Rebuild the SDK
cd packages/sdk
./refresh-link.sh
# Or: pnpm debug:rebuild

# Restart your test app's dev server
```

**Options:**

```bash
# Create test app with custom slug
./debug-link.sh --slug my-custom-app

# Skip build (if you just want to relink)
./debug-link.sh --skip-build

# Verbose output
./debug-link.sh --verbose

# Use test environment
./debug-link.sh --test
```

### 2. **Tarball Install** (Recommended for Final Testing)

Use tarball approach when you want to test the exact package that will be published.

**Advantages:**
- Accurate: Tests exactly what gets published
- Isolated: No symlink weirdness
- Validates package.json `files` field

**Disadvantages:**
- Slower: Need to rebuild tarball for every change
- Cleanup: Tarballs accumulate in /tmp

**Workflow:**

```bash
# Build and test with tarball
cd packages/sdk
./debug-init.sh

# This will:
# 1. Build the SDK
# 2. Create a tarball (pnpm pack)
# 3. Create a test app in /tmp/auxx-test-*
# 4. Install SDK from tarball
```

## Quick Reference

### Common Tasks

**Initial setup with linking:**
```bash
cd packages/sdk
./debug-link.sh
# Or: pnpm debug:link
```

**Rebuild SDK after making changes:**
```bash
cd packages/sdk
./refresh-link.sh
# Or: pnpm debug:rebuild
```

**Test with tarball (before publishing):**
```bash
cd packages/sdk
./debug-init.sh
# Or: pnpm debug:tarball
```

**Manual link to existing project:**
```bash
# In SDK directory
cd packages/sdk
pnpm build

# In your project
cd /path/to/your/app
pnpm add "file:/Users/mklooth/Sites/auxx-ai/packages/sdk"
```

**List globally linked packages:**
```bash
pnpm list --global --depth 0
```

## Development Workflow Examples

### Scenario 1: Adding a new setting type

```bash
# 1. Create your test app
cd packages/sdk
./debug-link.sh --slug my-test-app

# 2. Start dev server in test app
cd /tmp/auxx-test-*/my-test-app
pnpm dev

# Keep dev server running...

# 3. In another terminal, edit SDK
cd packages/sdk
vim src/root/settings/new-setting-node.ts

# 4. Refresh the link
./refresh-link.sh

# 5. Restart dev server in test app
# Changes should now be reflected
```

### Scenario 2: Testing multiple apps simultaneously

```bash
# Link SDK globally once
cd packages/sdk
pnpm build
pnpm link --global

# Create multiple test apps
./debug-link.sh --slug app1 --skip-build
./debug-link.sh --slug app2 --skip-build
./debug-link.sh --slug app3 --skip-build

# Each app now links to the same SDK
# Update SDK and refresh:
./refresh-link.sh

# All apps now have the updated SDK
```

### Scenario 3: Pre-publish validation

```bash
# After all development is complete
cd packages/sdk

# Clean build
pnpm clean
pnpm install
pnpm build

# Test with tarball (simulates npm install)
./debug-init.sh

# Verify the test app works
cd /tmp/auxx-test-*/test-app
pnpm dev

# If all good, publish
cd packages/sdk
npm version patch
npm publish
```

## Troubleshooting

### Symlink error: "path is the same as the target path"

**Problem:** `ERROR Symlink path is the same as the target path`

**Cause:** SDK is already linked globally

**Solutions:**
```bash
# Option 1: Unlink and relink (scripts now handle this automatically)
cd packages/sdk
./unlink-sdk.sh
./refresh-link.sh

# Option 2: Just run refresh (it now unlinks first)
./refresh-link.sh
```

**Note:** The scripts have been updated to automatically unlink before linking, so this should no longer occur.

### Link not updating

**Problem:** Changes to SDK not reflected in linked app

**Solutions:**
```bash
# 1. Ensure you ran refresh-link.sh
cd packages/sdk
./refresh-link.sh

# 2. Restart your app's dev server
# (stop and run pnpm dev again)

# 3. Clear pnpm's cache
pnpm store prune

# 4. Re-link manually
pnpm unlink --global
pnpm link --global
```

### Module resolution errors

**Problem:** `Cannot find module '@auxx/sdk'`

**Solutions:**
```bash
# 1. Verify SDK is linked globally
cd packages/sdk
pnpm list --global --depth 0 | grep @auxx/sdk

# 2. Verify app has link
cd /path/to/your/app
ls -la node_modules/@auxx

# Should show a symlink

# 3. Re-link
pnpm unlink --global @auxx/sdk
pnpm link --global @auxx/sdk
```

### TypeScript errors with linked package

**Problem:** Types not updating or TS errors

**Solutions:**
```bash
# 1. Ensure TypeScript declarations are built
cd packages/sdk
pnpm build
ls dist/*.d.ts  # Should exist

# 2. Restart TypeScript server in your editor
# VSCode: Cmd+Shift+P > "TypeScript: Restart TS Server"

# 3. Check tsconfig.json in your app includes SDK types
```

### Keytar build errors

**Problem:** Keytar binary issues during init

**Solution:**
```bash
# Rebuild keytar binaries
cd packages/sdk
pnpm run build:keytar

# macOS: Ensure Xcode tools installed
xcode-select --install

# Linux: Ensure build tools installed
sudo apt-get install build-essential libsecret-1-dev
```

### Multiple Node versions

**Problem:** Link breaks after switching Node versions

**Solution:**
```bash
# Re-link after switching Node
cd packages/sdk
pnpm link --global

# Or use a Node version manager with project-level config
# .nvmrc file already exists in repo root
```

## Best Practices

1. **Always build before linking**
   ```bash
   pnpm build && pnpm link --global
   ```

2. **Use refresh-link.sh for updates**
   - Don't manually rebuild and relink
   - The script handles both steps correctly

3. **Test with tarball before publishing**
   - Use `./debug-init.sh` for final validation
   - Ensures package.json `files` field is correct

4. **Clean builds periodically**
   ```bash
   pnpm clean
   rm -rf node_modules
   pnpm install
   pnpm build
   ```

5. **Version control**
   - Don't commit test apps created in /tmp
   - Don't commit .tgz files
   - These are already in .gitignore

## Script Reference

### debug-link.sh

Creates a test app and links SDK using pnpm link.

**Usage:**
```bash
./debug-link.sh [options]

Options:
  --slug, -s <name>    App slug (default: test-app)
  --test              Use NODE_ENV=test
  --verbose, -v       Verbose output
  --skip-build        Skip SDK build step
```

**Example:**
```bash
./debug-link.sh --slug my-app --verbose
```

### refresh-link.sh

Rebuilds SDK and refreshes the global link.

**Usage:**
```bash
./refresh-link.sh [options]

Options:
  --verbose, -v       Verbose output
  --skip-build        Skip build (just relink)
```

**Example:**
```bash
# Full rebuild and relink
./refresh-link.sh

# Just relink (if already built)
./refresh-link.sh --skip-build
```

### unlink-sdk.sh

Removes the global SDK link.

**Usage:**
```bash
./unlink-sdk.sh
```

**Example:**
```bash
# Clean up global link
./unlink-sdk.sh
```

### debug-init.sh

Original script that uses tarball installation.

**Usage:**
```bash
./debug-init.sh [options]

Options:
  --slug, -s <name>    App slug (default: test-app)
  --test              Use NODE_ENV=test
  --verbose, -v       Verbose output
```

**Example:**
```bash
./debug-init.sh --slug final-test
```

## pnpm link vs pnpm workspace

**Note:** Within this monorepo, apps can already use the SDK via workspace protocol:

```json
{
  "dependencies": {
    "@auxx/sdk": "workspace:*"
  }
}
```

**pnpm link is useful for:**
- Testing in external projects (outside monorepo)
- Simulating how consumers will use the package
- Testing published package behavior

**workspace protocol is useful for:**
- Internal monorepo development
- Always uses latest local version
- No linking required

## Additional Resources

- [pnpm link documentation](https://pnpm.io/cli/link)
- [pnpm workspace protocol](https://pnpm.io/workspaces#workspace-protocol-workspace)
- [npm pack documentation](https://docs.npmjs.com/cli/v9/commands/npm-pack)
