import { expect, test } from "@playwright/test";

const viewport = { width: 1440, height: 1000 };
const sampleCount = 120;
const warmupCount = 20;
const scales = [10, 25, 50] as const;

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test("records reproducible hover pointermove-to-frame proxy at increasing native-geometry scales", async ({ page }) => {
  await page.setViewportSize(viewport);
  const records: Array<Record<string, unknown>> = [];

  for (const geometryCount of scales) {
    await page.goto("/");
    await page.getByRole("button", { name: "Proyectos" }).click();
    await page.getByRole("button", { name: "+ Nuevo proyecto" }).click();
    await page.getByLabel("Nombre del proyecto").fill(`Pointer frame ${geometryCount}`);
    await page.getByRole("button", { name: "Crear proyecto" }).click();
    await page.getByRole("region", { name: "Piezas" }).getByRole("button", { name: "+ Nueva pieza" }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva pieza" });
    await dialog.getByLabel("Nombre de la pieza").fill(`Workload ${geometryCount}`);
    await dialog.getByRole("button", { name: "Crear pieza" }).click();

    const canvas = page.locator(".page");
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    const rectangleTool = page.getByRole("button", { name: "Rectángulo", exact: true });
    await rectangleTool.click();
    for (let index = 0; index < geometryCount; index += 1) {
      const x = bounds!.x + 70 + (index % 12) * 40;
      const y = bounds!.y + 70 + Math.floor(index / 12) * 35;
      await page.mouse.click(x, y);
      await page.mouse.click(x + 18, y + 12);
    }

    const nativeGeometry = page.locator('.page-svg svg rect[data-element-id]');
    await expect(nativeGeometry).toHaveCount(geometryCount);
    const geometryIdsBefore = await canvas.getAttribute("data-document-element-ids");
    const revisionBefore = await canvas.getAttribute("data-document-revision");
    expect(geometryIdsBefore).toBeTruthy();
    expect(revisionBefore).toBeTruthy();

    const targets = await page.locator(".page").evaluate((element, count) => {
      const bounds = element.getBoundingClientRect();
      return Array.from({ length: count }, (_, index) => ({
        x: Math.round(bounds.left + 38 + (index % 17) * 2),
        y: Math.round(bounds.top + 38 + (index % 13) * 2),
      }));
    }, warmupCount + sampleCount);
    await page.evaluate(() => {
      const globalWindow = window as unknown as Window & {
        __pointerFrameProxy?: {
          arm: () => void;
          take: () => Promise<number>;
          dispose: () => void;
        };
      };
      let armed = false;
      let disposed = false;
      let pending: { resolve: (duration: number) => void; reject: (error: Error) => void; promise: Promise<number> } | undefined;
      let completed: Promise<number> | undefined;
      let timeoutId: number | undefined;
      let frameId: number | undefined;
      const clearPending = () => {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        if (frameId !== undefined) window.cancelAnimationFrame(frameId);
        timeoutId = undefined;
        frameId = undefined;
      };
      const onPointerMove = (event: PointerEvent) => {
        if (!armed || event.pointerType !== "mouse" || !pending) return;
        armed = false;
        const eventTimestamp = event.timeStamp;
        frameId = window.requestAnimationFrame(() => {
          frameId = undefined;
          if (!pending) return;
          clearPending();
          pending.resolve(performance.now() - eventTimestamp);
          completed = pending.promise;
          pending = undefined;
        });
      };
      document.addEventListener("pointermove", onPointerMove, true);
      globalWindow.__pointerFrameProxy = {
        arm: () => {
          if (disposed) throw new Error("Pointer frame observer has been disposed");
          if (pending) throw new Error("Pointer frame observer already has a pending sample");
          let resolve!: (duration: number) => void;
          let reject!: (error: Error) => void;
          const promise = new Promise<number>((res, rej) => { resolve = res; reject = rej; });
          // Disposal or timeout may occur before take() is called; this prevents an unhandled rejection.
          void promise.catch(() => undefined);
          pending = { resolve, reject, promise };
          completed = undefined;
          armed = true;
          timeoutId = window.setTimeout(() => {
            if (!pending) return;
            const waiting = pending;
            pending = undefined;
            completed = waiting.promise;
            armed = false;
            clearPending();
            waiting.reject(new Error("Timed out waiting for pointermove-to-animation-frame sample"));
          }, 2_000);
        },
        take: () => {
          if (pending) return pending.promise;
          if (completed) return completed;
          throw new Error("No pointer frame sample is armed");
        },
        dispose: () => {
          if (disposed) return;
          disposed = true;
          armed = false;
          document.removeEventListener("pointermove", onPointerMove, true);
          clearPending();
          const waiting = pending;
          pending = undefined;
          if (waiting) {
            completed = waiting.promise;
            waiting.reject(new Error("Pointer frame observer disposed before sample completed"));
          }
          delete globalWindow.__pointerFrameProxy;
        },
      };
    });
    const durations: number[] = [];
    let measurement: Record<string, unknown>;
    try {
      for (const point of targets) {
        await page.evaluate(() => (window as unknown as Window & { __pointerFrameProxy: { arm: () => void } }).__pointerFrameProxy.arm());
        await page.mouse.move(point.x, point.y);
        durations.push(await page.evaluate(() => (window as unknown as Window & { __pointerFrameProxy: { take: () => Promise<number> } }).__pointerFrameProxy.take()));
      }
      const samples = durations.slice(warmupCount);
      expect(samples).toHaveLength(sampleCount);
      for (const [index, duration] of samples.entries()) {
        expect(Number.isFinite(duration) && duration >= 0, `sample ${index} must be finite and nonnegative; received ${duration}`).toBe(true);
      }
      measurement = await page.evaluate(({ timings, warmups: warmupSamples }) => {
        if (timings.length === 0 || timings.some((duration) => !Number.isFinite(duration) || duration < 0)) {
          throw new Error("Cannot calculate nearest-rank percentiles from missing or invalid durations");
        }
        const sorted = [...timings].sort((a, b) => a - b);
        const percentile = (p: number) => sorted[Math.ceil(p * sorted.length) - 1]!;
        return {
          samples: timings.length,
          warmups: warmupSamples,
          p50: percentile(0.5),
          p95: percentile(0.95),
          p99: percentile(0.99),
          userAgent: navigator.userAgent,
          devicePixelRatio: window.devicePixelRatio,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        };
      }, { timings: samples, warmups: warmupCount });
    } finally {
      await page.evaluate(() => (window as unknown as Window & { __pointerFrameProxy?: { dispose: () => void } }).__pointerFrameProxy?.dispose()).catch(() => undefined);
    }
    expect(measurement.samples).toBe(sampleCount);
    expect(await canvas.getAttribute("data-document-element-ids")).toBe(geometryIdsBefore);
    expect(await canvas.getAttribute("data-document-revision")).toBe(revisionBefore);
    records.push({ geometryCount, ...measurement });
    console.log(`POINTERMOVE_FRAME_PROXY ${JSON.stringify(records.at(-1))}`);
  }
});
