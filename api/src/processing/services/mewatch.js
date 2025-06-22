import { genericUserAgent } from "../../config.js";

async function getAssetMeta(id) {
    const url = `https://cdn.mewatch.sg/api/items/${id}?segments=all`;
    const headers = { 'User-Agent': genericUserAgent, Accept: 'application/json' };

    const data = await fetch(url, { headers }).then(r => r.json()).catch(() => {});
    const item = data?.items?.[0] ?? data;
    return {
        assetId: item?.customId || item?.customFields?.EntryId,
        title: item?.title
    };
}

export default async function({ id, title }) {
    const meta = await getAssetMeta(id);
    const assetId = meta.assetId;
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
        type: "merge",
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
