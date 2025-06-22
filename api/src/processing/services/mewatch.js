import { genericUserAgent } from "../../config.js";

export default async function({ id, title }) {
    const pageUrl = `https://www.mewatch.sg/movie/${title}-${id}`;
    const headers = {
        'User-Agent': genericUserAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    };

    const html = await fetch(pageUrl, { headers }).then(r => r.text()).catch(() => {});
    if (!html) return { error: "fetch.fail" };

    const assetMatch = html.match(/"assetId"\s*:\s*"?(\d+)"?/);
    const assetId = assetMatch ? assetMatch[1] : null;
    if (!assetId) return { error: "fetch.empty" };

    const body = {
        "1": { service: "ottuser", action: "anonymousLogin", partnerId: "147" },
        "2": { service: "asset", action: "get", id: assetId, assetReferenceType: "MEDIA", ks: "{1:result:ks}" },
        "3": {
            service: "asset",
            action: "getPlaybackContext",
            assetId: assetId,
            assetType: "MEDIA",
            contextDataParams: { objectType: "KalturaPlaybackContextOptions", context: "PLAYBACK" },
            ks: "{1:result:ks}"
        },
        apiVersion: "7.8.1",
        partnerId: "147"
    };

    const resp = await fetch(
        "https://rest-as.ott.kaltura.com/api_v3/service/multirequest",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": genericUserAgent
            },
            body: JSON.stringify(body)
        }
    ).then(r => r.json()).catch(() => {});

    const asset = resp?.result?.[1];
    const sources = resp?.result?.[2]?.sources;
    if (!asset || !sources) return { error: "fetch.fail" };

    const source = sources.find(s => !s.drm || !s.drm.length);
    if (!source) return { error: "content.protected" };

    const isHLS = source.format === "applehttp";

    return {
        urls: source.url,
        isHLS,
        filenameAttributes: {
            service: "mewatch",
            id: assetId,
            title: asset.name,
            extension: "mp4"
        },
        fileMetadata: { title: asset.name }
    };
}
