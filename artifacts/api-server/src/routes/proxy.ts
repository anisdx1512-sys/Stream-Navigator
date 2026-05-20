import { Router } from "express";

const router = Router();

router.get("/proxy/m3u", async (req, res) => {
  const url = req.query["url"] as string;
  if (!url) {
    res.status(400).json({ error: "url parameter required" });
    return;
  }
  try {
    const response = await fetch(decodeURIComponent(url), {
      headers: {
        "User-Agent": "Mozilla/5.0 (SmartTV) IPTV-Player/1.0",
      },
    });
    if (!response.ok) {
      res.status(response.status).json({ error: `Upstream returned ${response.status}` });
      return;
    }
    const text = await response.text();
    res.set("Content-Type", "text/plain; charset=utf-8");
    res.set("Cache-Control", "no-cache");
    res.send(text);
  } catch (err) {
    req.log.error({ err }, "M3U proxy error");
    res.status(500).json({ error: "Failed to fetch M3U playlist" });
  }
});

router.get("/proxy/epg", async (req, res) => {
  const url = req.query["url"] as string;
  if (!url) {
    res.status(400).json({ error: "url parameter required" });
    return;
  }
  try {
    const response = await fetch(decodeURIComponent(url), {
      headers: {
        "User-Agent": "Mozilla/5.0 (SmartTV) IPTV-Player/1.0",
      },
    });
    if (!response.ok) {
      res.status(response.status).json({ error: `Upstream returned ${response.status}` });
      return;
    }
    const text = await response.text();
    res.set("Content-Type", "application/xml; charset=utf-8");
    res.set("Cache-Control", "max-age=3600");
    res.send(text);
  } catch (err) {
    req.log.error({ err }, "EPG proxy error");
    res.status(500).json({ error: "Failed to fetch EPG data" });
  }
});

export default router;
