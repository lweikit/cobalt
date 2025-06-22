import { XMLParser } from "fast-xml-parser";
import { genericUserAgent } from "../../config.js";

async function getAssetMeta(id) {
    const url = `https://cdn.mewatch.sg/api/items/${id}?segments=all`;
    const headers = {
        "User-Agent": genericUserAgent,
        Accept: "application/json",
    };

    const data = await fetch(url, { headers })
        .then(r => r.json())
        .catch(() => {});
    const item = data?.items?.[0] ?? data;
    return {
        assetId: item?.customId || item?.customFields?.EntryId,
        entryId: item?.customFields?.EntryId,
        title: item?.title,
    };
}

export default async function ({ id, title }) {
    const transplantTunnel = true;

    const meta = await getAssetMeta(id);
    const assetId = meta.assetId;
    const entryId = meta.entryId || assetId;
    if (!assetId) return { error: "fetch.empty" };

    // Discover manifest URL dynamically
    const encodedResource = encodeURIComponent(
        `https://k-toggle.akamaized.net/edashncl/p/2082311/sp/208231100/serveFlavor/entryId/${entryId}/v/1/pv/1/ev/11/flavorId/1_,90b5x1r5,dsmpn88p,awpx15dg,/forceproxy/true/name/a.mp4.urlset/manifest.mpd`
    );

    const manifestDiscoveryUrl = `https://southeast-1.gnsnpaw.com/mediacorp/vod/decision?resource=${encodedResource}&extended=true&originCode=BAU&live=false`;
    const discoveryJson = await fetch(manifestDiscoveryUrl, {
        headers: { "User-Agent": genericUserAgent },
    })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null);

    const providers = discoveryJson?.providers;
    const discoveredSourceUrl = providers?.[0]?.url;

    const body = {
        1: { service: "ottuser", action: "anonymousLogin", partnerId: "147" },
        2: {
            service: "asset",
            action: "get",
            id: assetId,
            assetReferenceType: "MEDIA",
            ks: "{1:result:ks}",
        },
        3: {
            service: "asset",
            action: "getPlaybackContext",
            assetId: assetId,
            assetType: "MEDIA",
            contextDataParams: {
                objectType: "KalturaPlaybackContextOptions",
                context: "PLAYBACK",
            },
            ks: "{1:result:ks}",
        },
        apiVersion: "7.8.1",
        partnerId: "147",
    };

    const resp = await fetch("https://rest-as.ott.kaltura.com/api_v3/service/multirequest", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "User-Agent": genericUserAgent,
        },
        body: JSON.stringify(body),
    })
        .then(r => r.json())
        .catch(() => {});

    const asset = resp?.result?.[1];
    const sources = resp?.result?.[2]?.sources;
    if (!asset || !sources) return { error: "fetch.fail" };

    const source = sources.find(s => !s.drm || !s.drm.length);
    if (!source) return { error: "content.protected" };
    const isDASH = discoveredSourceUrl?.endsWith("manifest.mpd");

    let dashSegments;
    if (isDASH) {
        const dashManifestText = await fetch(discoveredSourceUrl, {
            headers: { "User-Agent": genericUserAgent },
        })
            .then(r => (r.ok ? r.text() : null))
            .catch(() => null);

        if (!dashManifestText) {
            return { error: "dash.fetch_fail" };
        }

        try {
            const parser = new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: "",
            });
            const parsedMPD = parser.parse(dashManifestText, {
                ignoreAttributes: false,
                attributeNamePrefix: "",
            });

            const baseURL = parsedMPD.MPD.BaseURL || "";
            const period = parsedMPD.MPD.Period;
            const adaptationSets = Array.isArray(period.AdaptationSet)
                ? period.AdaptationSet
                : [period.AdaptationSet];

            const segments = [];

            for (const set of adaptationSets) {
                const representations = Array.isArray(set.Representation)
                    ? set.Representation
                    : [set.Representation];

                for (const rep of representations) {
                    const segBase = rep.SegmentList || rep.SegmentTemplate || set.SegmentTemplate;
                    // revised: handle case where media is on set.SegmentTemplate, not directly on segBase
                    if (segBase && (segBase.media || set.SegmentTemplate?.media)) {
                        const startNumber = Number(segBase.startNumber || 1);
                        const mediaTemplate = segBase.media || set.SegmentTemplate.media;
                        const count = 10; // default to first 30 segments

                        for (let i = startNumber; i < startNumber + count; i++) {
                            const replaced = mediaTemplate
                                .replace(/\$Number\$/g, i)
                                .replace(/\$RepresentationID\$/g, rep.id ?? "");
                            const url = baseURL + replaced;
                            segments.push({
                                type: "internal",
                                data: {
                                    url,
                                    service: "mewatch",
                                    headers: { "User-Agent": genericUserAgent },
                                    isHLS: false,
                                    codec: rep.codecs,
                                    resolution:
                                        rep.width && rep.height
                                            ? `${rep.width}x${rep.height}`
                                            : undefined,
                                    bandwidth: rep.bandwidth,
                                    representationId: rep.id,
                                    originalRequest: { id, title },
                                    transplant: transplantTunnel,
                                },
                            });
                        }
                    }
                }
            }

            dashSegments = segments;
        } catch (e) {
            return { error: "dash.parse_fail" };
        }
    }

    return {
        exp: Date.now() + 60 * 60 * 1000, // 1 hour expiry
        type: "merge",
        urls: isDASH ? dashSegments : [source.url],
        service: "mewatch",
        filename: `${asset.name}.mp4`,
        metadata: { title: asset.name },
        audioCopy: false,
        isHLS: false,
        originalRequest: { id, title },
        transplant: transplantTunnel,
    };
}
