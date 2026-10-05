import { defineConfig } from "vite";

export default defineConfig({
    base: "/omega-clouds-pbr/",
    server: {
        watch: {
            // Ensure add/unlink events fire for public/ files (they're
            // otherwise ignored by the dev watcher).
            ignored: ["!**/public/**"],
        },
    },
    plugins: [
        {
            name: "watch-shaders",
            configureServer(server) {
                // Files in public/ (shaders, textures) are fetched at runtime,
                // so they aren't in Vite's module graph — reload manually.
                let reloadTimer: ReturnType<typeof setTimeout> | undefined;
                const triggerReload = (file: string) => {
                    // Only care about public/ (JetBrains "safe write" fires
                    // add/unlink via a temp-file rename, not change).
                    if (!file.replace(/\\/g, "/").includes("/public/")) {
                        return;
                    }
                    // Debounce: a single save can emit unlink + add together.
                    clearTimeout(reloadTimer);
                    reloadTimer = setTimeout(() => {
                        console.log(`public file changed: ${file} — reloading`);
                        server.hot.send({ type: "full-reload" });
                    }, 50);
                };

                server.watcher.on("change", triggerReload);
                server.watcher.on("add", triggerReload);
                server.watcher.on("unlink", triggerReload);
            },
        },
    ],
});
