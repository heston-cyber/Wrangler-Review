import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

// Frames are always stored as integers counted from the first frame of the version (frame 0).
// Timecode is derived from frames + the version's start timecode, never from seconds.
export default defineSchema({
  ...authTables,
  // Client side (C1, Oct 23): the auth users table with a role. Owners are the ALLOWED_EMAILS list (Heston);
  // clients are people he invited. Anyone else can't make an account.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    role: v.optional(v.union(v.literal("owner"), v.literal("client"))),
    lastSignInAt: v.optional(v.number()),
  }).index("email", ["email"]).index("phone", ["phone"]),
  // Emails allowed to make a client account. Made by the owner (the Share dialog in C2, or Settings › Clients).
  invites: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    email: v.string(),            // lower-case
    name: v.optional(v.string()), // what Heston calls them, shown until they set their own
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    userId: v.optional(v.id("users")),
  }).index("by_email", ["email"]),

  // Shares (client side C2, Oct 23): a link that lets someone outside see a client, a project or one video.
  // "link" shares open for anyone with the address (optionally behind a passcode); "invited" shares open only for
  // signed-in accounts whose email is on the share (shareMembers) and still invited. Off and expired are refused
  // the moment they happen. What a share covers is computed live (a new video under a shared project is covered).
  shares: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    token: v.string(), // the random part of review.wranglerportal.com/s/<token>
    kind: v.union(v.literal("client"), v.literal("project"), v.literal("video")),
    client: v.optional(v.string()),        // kind "client": the client name as filed on its projects
    clientId: v.optional(v.id("clients")),  // Phase 0.5d step 5: that client's record
    projectId: v.optional(v.id("projects")),
    videoId: v.optional(v.id("videos")),
    access: v.union(v.literal("view"), v.literal("comment")),
    who: v.union(v.literal("link"), v.literal("invited")),
    allVersions: v.boolean(),    // off = only the latest version
    downloads: v.boolean(),      // allow downloading the 1080p file (C3)
    emailNewVersions: v.boolean(), // email the people on it when a new version lands (C4)
    expiresAt: v.optional(v.number()),
    passcodeHash: v.optional(v.string()), // link shares only; SHA-256 of token + passcode
    createdAt: v.number(),
    createdBy: v.id("users"),
    offAt: v.optional(v.number()),
    lastOpenedAt: v.optional(v.number()),
    openCount: v.optional(v.number()),
    passFails: v.optional(v.number()),       // wrong passcodes in a row (security review, Oct 23)
    passLockedUntil: v.optional(v.number()), // no more tries until then
  }).index("by_token", ["token"]).index("by_video", ["videoId"]).index("by_project", ["projectId"]),

  // The emails on an invited share.
  shareMembers: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    shareId: v.id("shares"),
    email: v.string(), // lower-case
    addedAt: v.number(),
    emailedAt: v.optional(v.number()),
  }).index("by_share", ["shareId"]).index("by_email", ["email"]),

  // What happened on a share: opened, a video viewed, a note left (C3). `who` is a name or email, or "guest".
  shareActivity: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    shareId: v.id("shares"),
    kind: v.union(v.literal("opened"), v.literal("viewed"), v.literal("note")),
    who: v.string(),
    whoKey: v.optional(v.string()), // who, for telling people apart (guest browser key / user id); never shown
    videoId: v.optional(v.id("videos")),
    noteId: v.optional(v.id("notes")),
    at: v.number(),
  }).index("by_share", ["shareId", "at"]).index("by_at", ["at"]),

  // C9 (Oct 26): views. One row per sitting (a page load of a version by one person): how far they got and how much
  // they watched, from the player's heartbeat. The owner's own sittings are kept but never counted.
  views: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    videoId: v.id("videos"),
    versionId: v.id("versions"),
    shareId: v.optional(v.id("shares")),
    session: v.string(),          // random per page load, from the browser
    kind: v.union(v.literal("owner"), v.literal("client"), v.literal("guest")),
    who: v.string(),              // the name shown ("Pat (guest)")
    whoKey: v.string(),           // for telling people apart; never shown
    startedAt: v.number(),
    lastAt: v.number(),
    watchedSec: v.number(),       // seconds of playback seen (rewatching counts again)
    maxSec: v.number(),           // the furthest point reached
    lengthSec: v.number(),        // the version's length as the player saw it
    completed: v.boolean(),       // got within a few seconds of the end
  }).index("by_video", ["videoId", "lastAt"]).index("by_version", ["versionId", "lastAt"]).index("by_share", ["shareId", "lastAt"]).index("by_session", ["versionId", "session"]),

  // Emails (client side C4, Oct 23). Each address's "stop these" choices, with the random key its unsubscribe
  // links carry; and a log so each email goes out once (key = what it was about + who got it).
  emailPrefs: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    email: v.string(), // lower-case
    key: v.string(),
    versionsOff: v.optional(v.boolean()),
    repliesOff: v.optional(v.boolean()),
    notesOff: v.optional(v.boolean()), // Phase 1: notes from the business (missing = on unless both others are off)
    updatedAt: v.number(),
  }).index("by_email", ["email"]).index("by_key", ["key"]),
  emailLog: defineTable({
    key: v.string(),
    kind: v.string(),
    to: v.string(),
    at: v.number(),
    resendId: v.optional(v.string()),
  }).index("by_key", ["key"]).index("by_at", ["at"]),

  // Per-hour counters for what commenters may do (security review, Oct 23).
  rateLimits: defineTable({ key: v.string(), count: v.number(), hour: v.number() }).index("by_key", ["key"]).index("by_hour", ["hour"]),

  projects: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    name: v.string(),
    ledgerExportedAt: v.optional(v.number()),   // Phase 3 (D58): included in the Settings Sheet's "Job ledger" tab
    jobNumber: v.optional(v.string()),
    client: v.optional(v.string()),
    clientId: v.optional(v.id("clients")), // Phase 0.5d step 5: the client's record (kept in step with `client`)
    createdAt: v.number(),
    // C7: the Dropbox folder that made or matched this project (path_lower, e.g. /clients/floor trader/backrooms).
    // A renamed folder renames the project; a deleted folder only clears this.
    dropboxFolder: v.optional(v.string()),
    // Phase 2 Part A (Oct 29): the project hub. Stage is the Wrangler Way (Discovery → Delivery); missing = Discovery.
    stage: v.optional(v.union(v.literal("discovery"), v.literal("strategy"), v.literal("production"), v.literal("polish"), v.literal("delivery"))),
    nextStep: v.optional(v.string()),
    keyDates: v.optional(v.array(v.object({ label: v.string(), date: v.string() }))), // date: YYYY-MM-DD
    rounds: v.optional(v.number()),              // rounds per video on this project (missing: the client's, then the business's)
    deliveryUnlockedAt: v.optional(v.number()),  // final files open to the client from here (Part B: when the final invoice is paid)
    deliveryLinkDays: v.optional(v.number()),    // how long download links work after unlock (missing: 7)
    updatedAt: v.optional(v.number()),
  }).index("by_name", ["name"]).index("by_dropbox_folder", ["dropboxFolder"]).index("by_client", ["clientId"]),

  // Phase 2 Part A (Oct 29): the final files of a project. Locked until the project's delivery is unlocked; then each
  // opens as a link that expires. A file is either in Dropbox (by path) or a version on the site.
  deliveryFiles: defineTable({
    businessId: v.optional(v.id("businesses")),
    projectId: v.id("projects"),
    name: v.string(),
    size: v.optional(v.number()),
    kind: v.union(v.literal("dropbox"), v.literal("version")),
    dropboxPath: v.optional(v.string()),   // path_lower
    versionId: v.optional(v.id("versions")),
    note: v.optional(v.string()),          // "ProRes 422 HQ", "From the site"
    createdAt: v.number(),
  }).index("by_project", ["projectId", "createdAt"]),

  videos: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    projectId: v.id("projects"),
    title: v.string(),
    // The register (Oct 22): every video made from now on gets a number (never reused) and a short title,
    // which make its file names: 00001_LCArizona_v4. Older videos may have neither.
    number: v.optional(v.number()),
    shortTitle: v.optional(v.string()),
    // Approve final (R2b): the version kept when the others were deleted. A later upload clears it.
    final: v.optional(v.object({ version: v.number(), at: v.number() })),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]).index("by_number", ["number"]),

  // Settings that follow the account to every device (R2b: which details show in the library, Approve final on/off).
  userPrefs: defineTable({ userId: v.id("users"), key: v.string(), value: v.any(), updatedAt: v.number() }).index("by_user_key", ["userId", "key"]),

  // Counters that only go up (the next video number).
  counters: defineTable({ businessId: v.optional(v.id("businesses")), key: v.string(), value: v.number() }).index("by_key", ["key"]),

  // Read-only keys for the Google Sheet copy of the register. Only the hash is kept.
  sheetKeys: defineTable({ businessId: v.optional(v.id("businesses")), hash: v.string(), prefix: v.string(), createdAt: v.number(), lastUsedAt: v.optional(v.number()) }).index("by_hash", ["hash"]),

  versions: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    videoId: v.id("videos"),
    number: v.number(), // 1, 2, 3...
    status: v.union(v.literal("uploading"), v.literal("processing"), v.literal("ready"), v.literal("failed")),
    bunnyGuid: v.string(),
    fileName: v.string(),
    fileSize: v.optional(v.number()),
    fpsNum: v.optional(v.number()), // 24000
    fpsDen: v.optional(v.number()), // 1001
    frameCount: v.optional(v.number()),
    frameCountFrom: v.optional(v.union(v.literal("file"), v.literal("player"))), // "file" = counted in the MP4, exact
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    lengthSeconds: v.optional(v.number()),
    startTimecode: v.string(), // "01:00:00:00" unless the render started elsewhere
    mp4Heights: v.optional(v.array(v.number())), // MP4 copies Bunny made, e.g. [240, 360, 720, 1080]
    encodeProgress: v.optional(v.number()),
    pollCount: v.optional(v.number()),
    error: v.optional(v.string()),
    description: v.optional(v.string()), // what changed in this version
    uploaderName: v.optional(v.string()),
    dropboxPath: v.optional(v.string()), // where the original lives, when it came from the Dropbox drop folder
    createdAt: v.number(),
    readyAt: v.optional(v.number()),
    // Oct 21 measurement: each change in what Bunny has made while converting (and for a few minutes after),
    // to see how much sooner the 1080p copy is usable than "ready". s = Bunny status, p = progress %,
    // res = the copies Bunny lists, mp4 = the MP4 copies that actually answer on the CDN.
    stages: v.optional(v.array(v.object({ t: v.number(), s: v.number(), p: v.number(), res: v.string(), mp4: v.array(v.number()) }))),
    // Oct 21: the 1080p file failed to play on some device, so every device opens this version on the stream.
    streamOnly: v.optional(v.boolean()),
    // C8 (Oct 26): the preview picture — first non-black frame with the Wrangler wordmark, made in Heston's browser.
    // Used for link previews, the player's poster and list thumbnails.
    posterUrl: v.optional(v.string()),
    posterAt: v.optional(v.number()),
    // Oct 22 (R2b): space this version uses on Bunny (Bunny's storageSize: the original plus its copies).
    storageBytes: v.optional(v.number()),
    storageCheckedAt: v.optional(v.number()),
    // Render-to-review (R3, Oct 22): a review export is stored and played as it is ("file"); anything else is converted
    // by Bunny Stream as before ("stream", or missing). File versions have no bunnyGuid ("").
    source: v.optional(v.union(v.literal("stream"), v.literal("file"))),
    storagePath: v.optional(v.string()), // path in the Bunny Storage zone, e.g. review/<video>/<version>.mp4
    fileUrl: v.optional(v.string()), // the CDN address the player uses
    copyError: v.optional(v.string()),
    // The 360p scrub copy, made by the separate scrub library (BUNNY_SCRUB_*).
    scrubGuid: v.optional(v.string()),
    scrubStatus: v.optional(v.union(v.literal("pending"), v.literal("ready"), v.literal("failed"))),
    scrubPolls: v.optional(v.number()),
    scrubReadyAt: v.optional(v.number()),
    copyMs: v.optional(v.number()), // R3: how long the Dropbox → Bunny Storage copy took
  })
    .index("by_video", ["videoId", "number"])
    .index("by_guid", ["bunnyGuid"]),

  // Security review (Oct 27): recordings uploaded for voice notes. Only these storage ids can be attached to a note
  // or thrown away from the page, so a guest can't reach any other stored file (Sign PDFs, signatures).
  voiceUploads: defineTable({ businessId: v.optional(v.id("businesses")), storageId: v.id("_storage"), versionId: v.optional(v.id("versions")), createdAt: v.number() }).index("by_storage", ["storageId"]),
  notes: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    versionId: v.id("versions"),
    videoId: v.id("videos"),
    kind: v.union(v.literal("frame"), v.literal("range"), v.literal("general")),
    inFrame: v.optional(v.number()),
    outFrame: v.optional(v.number()), // inclusive last frame of a range
    drawFrame: v.optional(v.number()), // frame the drawing was made on
    text: v.string(),
    drawing: v.optional(v.any()), // { shapes: [...] } in 0-1 coordinates of the picture
    still: v.optional(v.string()), // URL: frame (with drawing if any)
    stillIn: v.optional(v.string()), // URL: first frame of a range
    stillOut: v.optional(v.string()), // URL: last frame of a range
    // Voice notes (Phase 3): the recording (private storage), each word pinned to the frame on screen when it was
    // said, and the pointing words ("this", "here"...) with a still of their frame.
    voice: v.optional(v.object({
      storageId: v.id("_storage"),
      mime: v.string(),
      durationMs: v.number(),
      language: v.optional(v.string()),
      played: v.boolean(), // the video was playing while you talked
      words: v.array(v.object({ t: v.string(), f: v.number(), s: v.number(), e: v.number() })),
      pointers: v.array(v.object({ word: v.string(), i: v.number(), f: v.number(), s: v.number(), still: v.optional(v.string()) })),
    })),
    status: v.union(v.literal("open"), v.literal("done")),
    authorName: v.string(),
    authorId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
    doneAt: v.optional(v.number()),
    notifiedAt: v.optional(v.number()),
    // Client side (C3, Oct 23): who may see the note. Heston's notes are private unless he marks them Shared;
    // notes left through a share are shared. Missing = private (every note from before C3).
    visibility: v.optional(v.union(v.literal("private"), v.literal("shared"))),
    guestKey: v.optional(v.string()),       // a guest's browser id, so they can edit their own notes
    shareId: v.optional(v.id("shares")),    // the share the note came through
    alertedAt: v.optional(v.number()),      // C4: when Heston's email about this client/guest note went out
    authorKind: v.optional(v.union(v.literal("owner"), v.literal("client"), v.literal("guest"))), // set by the server, never the name
  })
    .index("by_version", ["versionId"])
    .index("by_video", ["videoId"]),

  replies: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    noteId: v.id("notes"),
    text: v.string(),
    authorName: v.string(),
    authorId: v.optional(v.id("users")),
    createdAt: v.number(),
    // C3: a reply others can't see even when the note is shared (Claude's connector replies, until Heston shows one).
    hidden: v.optional(v.boolean()),
    guestKey: v.optional(v.string()),
    authorKind: v.optional(v.union(v.literal("owner"), v.literal("client"), v.literal("guest"))),
  }).index("by_note", ["noteId"]),

  // When each person last opened each video (Home's "Last opened", the sidebar list).
  opens: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    userId: v.id("users"),
    videoId: v.id("videos"),
    openedAt: v.number(),
  })
    .index("by_user", ["userId", "openedAt"])
    .index("by_user_video", ["userId", "videoId"]),

  // Keys for the Claude connector. Only a SHA-256 hash is stored; the key itself is shown once.
  connectorKeys: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    hash: v.string(),
    prefix: v.string(), // first characters, to tell keys apart in Settings
    label: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  }).index("by_hash", ["hash"]),

  // The connected Dropbox account (one row). Tokens never leave the backend.
  dropbox: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    accountId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    accessExpiresAt: v.optional(v.number()),
    cursor: v.optional(v.string()),
    connectedAt: v.number(),
    lastSyncAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  }),

  // One-time "state" values for the Connect Dropbox sign-in.
  oauthStates: defineTable({
    state: v.string(),
    userId: v.string(),
    createdAt: v.number(),
  }).index("by_state", ["state"]),

  // Every file seen in the drop folder, by path. A new revision of the same path is a new render.
  dropFiles: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    pathLower: v.string(),
    pathDisplay: v.string(),
    rev: v.string(),
    size: v.number(),
    status: v.union(
      v.literal("waiting"),   // seen; waiting for it to finish uploading and stop changing
      v.literal("importing"), // being handed to Bunny
      v.literal("imported"),  // a version was made
      v.literal("skipped"),   // not a video, or not in <Project>/<Video>/
      v.literal("failed"),
      v.literal("existing"),  // was already there when Dropbox was connected
      v.literal("flagged"),   // R3: its name needs fixing (unknown number, version already there, not a register name)
    ),
    reason: v.optional(v.string()),
    // C7: "Register & import" on a flagged file: the name the site gives it (the Dropbox file isn't renamed).
    registerAs: v.optional(v.object({ number: v.number(), shortTitle: v.string(), version: v.number() })),
    firstSeenAt: v.number(),
    lastChangeAt: v.number(),
    checks: v.number(),
    versionId: v.optional(v.id("versions")),
    shareUrl: v.optional(v.string()),
    linkRevokedAt: v.optional(v.number()),
    importedAt: v.optional(v.number()),
  })
    .index("by_path", ["pathLower"])
    .index("by_status", ["status"])
    .index("by_version", ["versionId"]),

  // What's said in each version, word by word, pinned to frames. The words themselves live in a JSON file in Convex storage.
  transcripts: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    versionId: v.id("versions"),
    status: v.union(v.literal("pending"), v.literal("running"), v.literal("done"), v.literal("failed")),
    storageId: v.optional(v.id("_storage")),
    language: v.optional(v.string()),
    wordCount: v.optional(v.number()),
    segmentCount: v.optional(v.number()),
    model: v.optional(v.string()),
    error: v.optional(v.string()),
    attempts: v.number(),
    updatedAt: v.number(),
  }).index("by_version", ["versionId"]),

  // Each version's sound as waveform peaks (0–255, `rate` per second), for the timeline. Made from Bunny's smallest MP4.
  waveforms: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    versionId: v.id("versions"),
    status: v.union(v.literal("pending"), v.literal("running"), v.literal("done"), v.literal("none"), v.literal("failed")),
    rate: v.optional(v.number()),
    seconds: v.optional(v.number()),
    peaks: v.optional(v.bytes()),
    error: v.optional(v.string()),
    attempts: v.number(),
    updatedAt: v.number(),
  }).index("by_version", ["versionId"]),

  // Clients made with "New client" before they have any projects. A client with projects is named on its projects.
  clients: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    name: v.string(),
    createdAt: v.number(),
    dropboxFolder: v.optional(v.string()), // C7: /clients/<name> when a folder made or matched it
    // Phase 0.5d step 5: made automatically because a project or share named this client (not shown as a
    // "New client" on its own); every client a project names now has a record, and projects link to it by id.
    fromProjects: v.optional(v.boolean()),
    rounds: v.optional(v.number()),          // Phase 2: rounds per video for this client's projects (missing: the business's)
    watermarkOff: v.optional(v.boolean()),   // Phase 2 (D24): review copies are watermarked unless switched off here
    subFailRule: v.optional(v.union(v.literal("past_due"), v.literal("cancel"))), // Phase 2b (D64): overrides the business's choice
    brandKit: v.optional(v.any()),           // Phase 3b (D71): the company's brand kit (convex/brandKit.ts)
  }).index("by_name", ["name"]).index("by_dropbox_folder", ["dropboxFolder"]),

  // Playback problems the browser reported (Oct 21), so they can be diagnosed on devices Claude can't reach.
  playerLogs: defineTable({
    versionId: v.id("versions"),
    at: v.number(),
    kind: v.string(), // error, fallback, stall
    code: v.optional(v.number()),
    msg: v.optional(v.string()),
    t: v.optional(v.number()), // seconds into the video
    src: v.optional(v.string()), // file or stream
    ua: v.optional(v.string()),
  }).index("by_at", ["at"]),

  // Phase R1 (Oct 22): results from the review-format test page (lab/r1.html), posted with the test link's key.
  r1Results: defineTable({
    at: v.number(),
    device: v.string(),
    rows: v.string(), // JSON
  }),

  // Stills kept in Convex storage until Bunny Storage is set up.
  stillFiles: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    storageId: v.id("_storage"),
    createdAt: v.number(),
  }),

  // ---------- Wrangler Sign (Phase S1, Oct 27) ----------
  // A document is a finished PDF Heston uploads to be signed. Every change after approval makes a new version; old
  // versions are kept, never overwritten. Boxes are where signatures, initials, names, dates and titles go, in
  // fractions of the page as displayed (see convex/lib/wsPdf.ts). Signer "heston" is Heston himself: his boxes are
  // filled with his adopted signature when the document is sent (S2).
  wsDocuments: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    number: v.number(),                 // WS-00001 …, from counters "wsNumber", never reused
    title: v.string(),
    status: v.union(v.literal("draft"), v.literal("approved"), v.literal("sent"), v.literal("completed"), v.literal("voided")),
    currentVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    // S2: sending
    sentAt: v.optional(v.number()),
    sentVersion: v.optional(v.number()),
    expiresAt: v.optional(v.number()),   // links stop working after this
    voidedAt: v.optional(v.number()),
    voidReason: v.optional(v.string()),
    completedAt: v.optional(v.number()), // every client signer has signed
    // S3: after everyone signs. Each step records its own result, so one failing doesn't stop the others and each
    // can be retried on its own.
    final: v.optional(v.object({ fileId: v.id("_storage"), sha256: v.string(), bytes: v.number(), fileName: v.string(), at: v.number() })),
    copies: v.optional(v.object({ status: v.union(v.literal("sent"), v.literal("partial"), v.literal("failed")), at: v.number(), sent: v.array(v.string()), failed: v.array(v.string()) })),
    invoice: v.optional(v.object({
      status: v.union(v.literal("created"), v.literal("none"), v.literal("failed")),
      at: v.number(), id: v.optional(v.string()), url: v.optional(v.string()), amountCents: v.optional(v.number()), livemode: v.optional(v.boolean()), error: v.optional(v.string()),
    })),
    archive: v.optional(v.object({
      status: v.union(v.literal("archived"), v.literal("waiting"), v.literal("failed")),
      at: v.number(), pdfPath: v.optional(v.string()), auditPath: v.optional(v.string()), verified: v.optional(v.boolean()), error: v.optional(v.string()),
    })),
    finishError: v.optional(v.string()), // the signed copy couldn't be made (shown to Heston with a Retry)
    hiddenAt: v.optional(v.number()),   // removed from the Docs list (Oct 27); the record is kept
    buildId: v.optional(v.id("wsBuilds")), // B2: made in the builder
    look: v.optional(v.object({ backdrop: v.string(), backdropImageId: v.optional(v.id("_storage")) })), // the signing page's background
  }).index("by_number", ["number"]).index("by_updated", ["updatedAt"]).index("by_final_sha", ["final.sha256"]),
  // B2–B3 (Oct 27): the doc builder. A build is the editable source of a document made from blocks (the blocks, the
  // fill-in fields and the style); "Continue to signing" renders it to a PDF, which becomes the document's version.
  // Blocks, fields and style are JSON shaped by src/builder/model.ts and checked there and in convex/builder.ts.
  wsBuilds: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    title: v.string(),
    blocks: v.any(),
    fields: v.any(),
    style: v.any(),
    signers: v.any(),                       // client signers (name, email, title) for when it's sent
    templateId: v.optional(v.id("wsTemplates")),
    documentId: v.optional(v.id("wsDocuments")), // set once it has gone to signing
    renderedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_updated", ["updatedAt"]).index("by_document", ["documentId"]),
  wsTemplates: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    name: v.string(),
    description: v.optional(v.string()),
    blocks: v.any(),
    fields: v.any(),
    style: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_updated", ["updatedAt"]),
  wsClauses: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    title: v.string(),
    body: v.any(),                          // rich text (the builder's text JSON)
    initials: v.boolean(),                  // ask the client to initial it
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_updated", ["updatedAt"]),
  // Styles, like craft.do's: named looks (fonts, colours, background colour or image, logo, page layout), one marked
  // default for new docs; a doc or template keeps its own copy, so changing a style later doesn't change sent PDFs.
  wsStyles: defineTable({ businessId: v.optional(v.id("businesses")), name: v.string(), style: v.any(), isDefault: v.boolean(), createdAt: v.number(), updatedAt: v.number() }).index("by_updated", ["updatedAt"]),
  wsProfile: defineTable({ businessId: v.optional(v.id("businesses")), business: v.any(), updatedAt: v.number() }), // the business details documents start with
  wsFonts: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    family: v.string(),
    weight: v.number(),                     // 400, 700 …
    italic: v.boolean(),
    fileId: v.id("_storage"),
    fileName: v.string(),
    source: v.union(v.literal("upload"), v.literal("local"), v.literal("google")),
    createdAt: v.number(),
  }).index("by_family", ["family"]),
  // S4: keys for Wrangler Sign's own Claude connector (/ws-mcp), separate from Wrangler Review's. Hash only.
  wsConnectorKeys: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    hash: v.string(),
    prefix: v.string(),
    label: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  }).index("by_hash", ["hash"]),
  // S3: the archive's own Dropbox app ("Wrangler Sign", App folder), separate from Wrangler Review's.
  wsDropbox: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    accountId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    accessExpiresAt: v.optional(v.number()),
    connectedAt: v.number(),
    lastError: v.optional(v.string()),
  }),
  // S2: one row per client signer of a sent version. The link is sign.wranglerportal.com/<token>; the email code
  // proves the signer controls the address it was sent to; a session (hash only) lets the page act after that.
  wsSignings: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    documentId: v.id("wsDocuments"),
    versionNumber: v.number(),
    signerKey: v.string(),
    name: v.string(),
    email: v.string(),
    title: v.optional(v.string()),
    order: v.number(),
    token: v.string(),
    status: v.union(v.literal("waiting"), v.literal("sent"), v.literal("signed"), v.literal("closed")),
    sentAt: v.optional(v.number()),
    lastEmailAt: v.optional(v.number()),
    openedAt: v.optional(v.number()),
    lastOpenEventAt: v.optional(v.number()),
    codeHash: v.optional(v.string()),
    codeExpiresAt: v.optional(v.number()),
    codeAttempts: v.optional(v.number()),
    codeSends: v.optional(v.array(v.number())),  // recent send times, for the rate limit
    failures: v.optional(v.array(v.number())),   // recent wrong codes
    failTotal: v.optional(v.number()),           // wrong codes over the link's whole life
    lockedUntil: v.optional(v.number()),
    verifiedAt: v.optional(v.number()),
    sessionHash: v.optional(v.string()),
    sessionExpiresAt: v.optional(v.number()),
    consentAt: v.optional(v.number()),
    consentVersion: v.optional(v.string()),
    viewedPages: v.optional(v.array(v.number())),
    adopted: v.optional(v.object({
      name: v.string(), title: v.optional(v.string()), method: v.union(v.literal("typed"), v.literal("drawn")),
      signatureFileId: v.id("_storage"), initialsFileId: v.id("_storage"), signatureSha256: v.string(), initialsSha256: v.string(), at: v.number(),
    })),
    initialed: v.optional(v.array(v.string())), // box ids
    signedAt: v.optional(v.number()),
    signedDate: v.optional(v.string()),           // the date written into date boxes, Central time
    signIp: v.optional(v.string()),
    signUserAgent: v.optional(v.string()),
  }).index("by_token", ["token"]).index("by_document", ["documentId", "versionNumber"]).index("by_email", ["email"]), // by_email: Phase 1, the client's Documents
  wsVersions: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    documentId: v.id("wsDocuments"),
    number: v.number(),
    fileId: v.id("_storage"),           // the PDF exactly as uploaded; never modified
    fileName: v.string(),
    fileSha256: v.string(),
    fileBytes: v.number(),
    pages: v.array(v.object({ width: v.number(), height: v.number(), rotate: v.number() })),
    hasTextLayer: v.optional(v.boolean()), // false: probably a scan, markers can't be found
    signers: v.array(v.object({
      key: v.string(),                  // "heston" or a client key ("client", "client2", …), as used in markers
      name: v.string(),
      email: v.string(),
      title: v.optional(v.string()),
      order: v.number(),                // 1, 2, … (used when signingOrder is "sequence")
    })),
    boxes: v.array(v.object({
      id: v.string(),
      signer: v.string(),
      kind: v.union(v.literal("sign"), v.literal("initials"), v.literal("name"), v.literal("date"), v.literal("title")),
      page: v.number(), x: v.number(), y: v.number(), w: v.number(), h: v.number(),
      cover: v.optional(v.object({ page: v.number(), x: v.number(), y: v.number(), w: v.number(), h: v.number() })),
      fromMarker: v.optional(v.boolean()),
    })),
    signingOrder: v.union(v.literal("any"), v.literal("sequence")),
    payment: v.optional(v.object({ amountCents: v.number(), description: v.string() })), // draft invoice on completion (S3)
    approvedAt: v.optional(v.number()),
    lockHash: v.optional(v.string()),   // SHA-256 over the file hash + layout + signers + payment, at approval
    ownerSignedAt: v.optional(v.number()),
    ownerSignatureId: v.optional(v.id("wsOwnerSignatures")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_document", ["documentId", "number"]),
  // The audit trail: append-only, one chain per document. hash = SHA-256(prevHash + this event's canonical JSON).
  wsEvents: defineTable({
    documentId: v.id("wsDocuments"),
    seq: v.number(),
    at: v.number(),
    kind: v.string(),
    actor: v.string(),                  // "heston", "claude", "signer:<key>", "system"
    versionNumber: v.optional(v.number()),
    email: v.optional(v.string()),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    detail: v.optional(v.string()),
    prevHash: v.string(),
    hash: v.string(),
  }).index("by_document", ["documentId", "seq"]),
  // Security review (Oct 27): what Claude asked to do through the connector (approve, send, cancel). Nothing happens
  // until Heston confirms it on the document page, signed in; a request lasts a day.
  wsRequests: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    documentId: v.id("wsDocuments"),
    what: v.union(v.literal("approve"), v.literal("send"), v.literal("cancel")),
    versionNumber: v.number(),
    expiresInDays: v.optional(v.number()),
    reason: v.optional(v.string()),
    said: v.string(),                      // what Claude said Heston told it in chat
    status: v.union(v.literal("pending"), v.literal("done"), v.literal("declined"), v.literal("expired"), v.literal("replaced"), v.literal("failed"), v.literal("overtaken")),  // overtaken: Heston did it himself with the page's own buttons
    error: v.optional(v.string()),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
  }).index("by_document", ["documentId", "status"]).index("by_status", ["status", "createdAt"]),
  // Heston's adopted signature. A new adoption replaces the old one (replacedAt); old ones are kept for the record.
  wsOwnerSignatures: defineTable({
    businessId: v.optional(v.id("businesses")), // Phase 0.5d step 2; required from step 3
    name: v.string(),
    title: v.string(),
    method: v.union(v.literal("typed"), v.literal("drawn")),
    signatureFileId: v.id("_storage"),
    initialsFileId: v.id("_storage"),
    signatureSha256: v.string(),
    initialsSha256: v.string(),
    adoptedAt: v.number(),
    replacedAt: v.optional(v.number()),
  }).index("by_adopted", ["adoptedAt"]),

  // Phase 0 only: results of the frame-accuracy test page (lab/frametest.html).
  phase0Runs: defineTable({
    createdAt: v.string(),
    label: v.string(),
    device: v.string(),
    browser: v.string(),
    source: v.string(),
    engine: v.string(),
    pass: v.boolean(),
    userAgent: v.string(),
    results: v.any(),
    misses: v.any(),
  }),

  // Wrangler Portal, Phase 0.5d step 1 (Oct 28): more than one business. Wrangler Productions is business #1
  // (slug "wrangler"). A membership ties a person (by email; their account once they have one) to a business with a
  // role. Step 1 only adds these; nothing reads a business yet except the access helpers, which pass it along.
  businesses: defineTable({
    slug: v.string(),               // short, unique, lower-case ("wrangler")
    name: v.string(),               // "Wrangler Productions"
    legalName: v.optional(v.string()), // "Wrangler Productions, a DBA of Hill Creative LLC"
    createdAt: v.number(),
    // Phase 1 (Oct 29): Business settings. The portal, its emails and the signing pages wear these.
    ownerName: v.optional(v.string()),     // "Heston Hill": who the emails say sent things
    emailFromName: v.optional(v.string()), // the From name on emails ("Wrangler Productions")
    replyTo: v.optional(v.string()),       // where clients' replies go (defaults to the owner's email)
    address: v.optional(v.string()),       // Oct 30: shown on invoices, receipts and email footers (Stripe requires it on receipts)
    privacyUrl: v.optional(v.string()),    // the privacy policy link, same places
    logoFileId: v.optional(v.id("_storage")), // shown in the portal and on emails
    logoLightFileId: v.optional(v.id("_storage")), // the same logo for light backgrounds (emails, PDFs); Settings › Business, Oct 29
    accent: v.optional(v.string()),        // #rrggbb
    background: v.optional(v.string()),    // #rrggbb
    // Which modules the business uses. Menu items only show when on (and only once something is in them).
    modules: v.optional(v.object({ review: v.boolean(), docs: v.boolean(), payments: v.boolean(), projects: v.optional(v.boolean()) })),
    updatedAt: v.optional(v.number()),
    // Phase 2 Part A (Oct 29): revision rounds (each version is a round, D23; default 2, D23b) and the watermark look
    // on review copies (D24: on for every client unless switched off on the client).
    roundsDefault: v.optional(v.number()),
    roundsOff: v.optional(v.boolean()), // revision rounds switched off for the whole business
    watermark: v.optional(v.object({ corner: v.union(v.literal("tl"), v.literal("tr"), v.literal("bl"), v.literal("br")), size: v.union(v.literal("small"), v.literal("large")), opacity: v.number() })),
    // Phase 2 Part B (D45): the business's own Stripe account, connected to the portal's platform account. Money goes
    // straight to it; the portal only mirrors what Stripe holds.
    stripe: v.optional(v.object({
      accountId: v.string(),
      status: v.union(v.literal("pending"), v.literal("needs_info"), v.literal("connected"), v.literal("disconnected")),
      chargesEnabled: v.boolean(), payoutsEnabled: v.boolean(), detailsSubmitted: v.boolean(),
      displayName: v.optional(v.string()), bankLast4: v.optional(v.string()), livemode: v.boolean(),
      due: v.optional(v.array(v.string())), disabledReason: v.optional(v.string()), verifying: v.optional(v.boolean()),
      methods: v.optional(v.array(v.string())),           // what clients can pay with: card, us_bank_account, link
      // Apple Pay, Google Pay and Link in the portal's Pay page need the portal's address registered on the business's
      // own account (direct charges). Done once per address, when the account is connected or on the first Pay.
      domain: v.optional(v.object({ name: v.string(), at: v.number(), ok: v.boolean(), applePay: v.optional(v.string()), error: v.optional(v.string()) })),
      startedAt: v.number(), connectedAt: v.optional(v.number()), disconnectedAt: v.optional(v.number()), checkedAt: v.number(),
    })),
    // Phase 3: Settings › Estimate rates (lib/estimate.ts Rates). Missing: Wrangler's from me-wrangler § 4, others empty.
    estimateRates: v.optional(v.any()),
    brandKit: v.optional(v.any()),           // Phase 3b (D71): Settings › Brand kit (convex/brandKit.ts)
    // Phase 2b (D64): when Stripe's last retry of a subscription payment fails: keep it past due (default) or cancel it.
    subFailRule: v.optional(v.union(v.literal("past_due"), v.literal("cancel"))),
    // Phase 2 Part B step 4 (D51): automatic invoice reminders, off until the owner turns them on (that's their OK).
    reminders: v.optional(v.object({
      on: v.boolean(),
      beforeDays: v.number(),   // days before the due date (0 = none before)
      afterDays: v.number(),    // the first overdue reminder, days after the due date (0 = on the day)
      everyDays: v.number(),    // then every n days while overdue
      stopAfter: v.number(),    // at most this many overdue reminders
    })),
  }).index("by_slug", ["slug"]).index("by_stripe_account", ["stripe.accountId"]),

  // Phase 3 (Oct 31): the pipeline. A deal is one card: a lead from the website or added by hand, or the job an estimate
  // is for. Seven fixed stages (D59); events only ever move a card forward, a card dragged by hand stays until a later
  // event moves it further (D60). Back office only.
  deals: defineTable({
    businessId: v.optional(v.id("businesses")),
    title: v.string(),
    clientId: v.optional(v.id("clients")),       // the company (made at the first estimate for a website lead, D56)
    contactEmail: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    documentId: v.optional(v.id("wsDocuments")), // the contract drafted from its estimate
    estimateId: v.optional(v.id("estimates")),
    valueCents: v.optional(v.number()),
    stage: v.union(v.literal("lead"), v.literal("quoted"), v.literal("contract_sent"), v.literal("signed"), v.literal("in_production"), v.literal("delivered"), v.literal("paid")),
    source: v.union(v.literal("website"), v.literal("hand"), v.literal("estimate")),
    lead: v.optional(v.object({ name: v.string(), email: v.string(), company: v.optional(v.string()), phone: v.optional(v.string()), message: v.optional(v.string()),
      fields: v.array(v.object({ label: v.string(), value: v.string() })), at: v.number() })),
    closedAt: v.optional(v.number()),            // "Not a lead", or taken off the board
    history: v.array(v.object({ kind: v.string(), at: v.number(), by: v.optional(v.string()), detail: v.optional(v.string()) })),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]).index("by_document", ["documentId"]).index("by_client", ["clientId"]),

  estimates: defineTable({
    businessId: v.optional(v.id("businesses")),
    dealId: v.optional(v.id("deals")),
    clientId: v.optional(v.id("clients")),
    projectId: v.optional(v.id("projects")),
    title: v.string(),
    scope: v.string(),
    input: v.any(),                              // EstimateInput (lib/estimate.ts) plus the shooting unit
    rates: v.any(),                              // the rates as they were when it was saved
    result: v.any(),                             // Estimate (lib/estimate.ts)
    documentId: v.optional(v.id("wsDocuments")),
    buildId: v.optional(v.id("wsBuilds")),
    contractAt: v.optional(v.number()),         // when Make contract draft last wrote the draft (its numbers are from this save)
    contractClaimAt: v.optional(v.number()),    // a Make contract draft in progress (one at a time)
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_deal", ["dealId"]).index("by_project", ["projectId"]),

  followUps: defineTable({
    businessId: v.optional(v.id("businesses")),
    dealId: v.optional(v.id("deals")),
    clientId: v.optional(v.id("clients")),
    who: v.string(),
    email: v.optional(v.string()),
    about: v.string(),
    due: v.string(),                             // yyyy-mm-dd
    note: v.optional(v.string()),
    remind: v.optional(v.union(v.literal("morning_of"), v.literal("day_before"))), // "Remind me" (Add follow-up dialog)
    doneAt: v.optional(v.number()),
    draft: v.optional(v.boolean()),              // made by Claude: does nothing until confirmed (D67)
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_client", ["clientId"]).index("by_deal", ["dealId"]),

  // The job ledger (a project tab): hours and costs logged against the project, compared with its estimate.
  ledgerEntries: defineTable({
    businessId: v.optional(v.id("businesses")),
    projectId: v.id("projects"),
    kind: v.union(v.literal("hours"), v.literal("cost")),
    workId: v.optional(v.string()),              // the kind of work (rates) the hours or cost is for
    costId: v.optional(v.string()),              // which subcontractor cost (rates) the hours are paid at
    hours: v.optional(v.number()),               // hours, or days for a kind billed per day
    cents: v.optional(v.number()),
    who: v.optional(v.string()),                 // "Heston", a subcontractor
    note: v.optional(v.string()),
    date: v.string(),
    draft: v.optional(v.boolean()),              // drafted by Claude from notes: counts once confirmed (D67)
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_project", ["projectId"]),

  // Phase 2b (Oct 30): plans. A plan is a price the owner reuses for subscriptions; it lives as a product with a price
  // in the business's own Stripe account (direct charges). Changing the price makes a new Stripe price; subscriptions
  // already on the old one keep it (as drawn: "changing a plan's price later doesn't change subscriptions").
  plans: defineTable({
    businessId: v.optional(v.id("businesses")),
    name: v.string(),
    description: v.optional(v.string()),
    amountCents: v.number(),
    interval: v.union(v.literal("day"), v.literal("week"), v.literal("month"), v.literal("year")),
    intervalCount: v.number(),
    stripe: v.object({ accountId: v.string(), productId: v.string(), priceId: v.string(), livemode: v.boolean() }),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_price", ["stripe.priceId"]),

  // Phase 2b: subscriptions, the portal's copy of each one in the business's Stripe (kept in step by Stripe's events).
  subscriptions: defineTable({
    businessId: v.optional(v.id("businesses")),
    clientId: v.optional(v.id("clients")),
    projectId: v.optional(v.id("projects")),
    planId: v.id("plans"),
    priceId: v.string(),                // the Stripe price as it was when the owner started it
    planName: v.string(),
    planDescription: v.optional(v.string()),
    amountCents: v.number(),
    interval: v.union(v.literal("day"), v.literal("week"), v.literal("month"), v.literal("year")),
    intervalCount: v.number(),
    billTo: v.object({ name: v.string(), email: v.string() }),
    // incomplete: waiting on the first payment; scheduled: starts on a later date
    status: v.union(v.literal("starting"), v.literal("scheduled"), v.literal("incomplete"), v.literal("trialing"), v.literal("active"), v.literal("past_due"),
      v.literal("paused"), v.literal("unpaid"), v.literal("canceled"), v.literal("incomplete_expired")),
    startDate: v.string(),              // yyyy-mm-dd, as the owner picked it
    trialDays: v.optional(v.number()),
    firstInvoice: v.union(v.literal("now"), v.literal("start")),
    payToken: v.string(),               // the client's page for this subscription (/sub/<token>), with or without an account
    stripe: v.optional(v.object({ accountId: v.string(), customerId: v.string(), subscriptionId: v.optional(v.string()), scheduleId: v.optional(v.string()), livemode: v.boolean() })),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    trialEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    canceledAt: v.optional(v.number()),
    pause: v.optional(v.object({ at: v.number(), resumesAt: v.optional(v.number()) })),
    method: v.optional(v.string()),     // "Visa •••• 4242"
    lastFailure: v.optional(v.object({ at: v.number(), message: v.string(), invoice: v.optional(v.string()), nextTry: v.optional(v.number()) })),
    history: v.array(v.object({ kind: v.string(), at: v.number(), by: v.optional(v.string()), detail: v.optional(v.string()) })),
    createdBy: v.optional(v.string()),
    syncedAt: v.optional(v.number()),
    claimAt: v.optional(v.number()),    // review fix: one start in Stripe at a time (status "starting" while it's being made)
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_stripe_sub", ["stripe.subscriptionId"]).index("by_pay_token", ["payToken"]).index("by_client", ["clientId"]).index("by_bill_email", ["billTo.email"]),

  // Phase 2 Part B, step 2: invoices. A draft lives only in the portal; Send (the owner's confirm) makes it in the
  // business's own Stripe account, gives it its number (D52) and finalizes it. From then on Stripe holds the money
  // and the webhook keeps this copy in step: open, processing, paid, partly paid, failed, void, uncollectible.
  invoices: defineTable({
    businessId: v.optional(v.id("businesses")),
    clientId: v.optional(v.id("clients")),
    projectId: v.optional(v.id("projects")),
    kind: v.union(v.literal("deposit"), v.literal("final"), v.literal("other"), v.literal("subscription")),
    subscriptionId: v.optional(v.id("subscriptions")), // Phase 2b: an invoice Stripe made for a subscription (charged automatically)
    title: v.string(),                                   // "Final invoice", "Deposit · WS-00018", "Extra shoot day"
    number: v.optional(v.string()),                      // D52: WRNGLR-0042, given when it's first sent
    billTo: v.object({ name: v.string(), email: v.string(), company: v.optional(v.string()) }),
    lines: v.array(v.object({ id: v.string(), description: v.string(), qty: v.number(), unitCents: v.number() })),
    discountCents: v.optional(v.number()),
    taxPercent: v.optional(v.number()),                 // e.g. 8.25
    dueDate: v.string(),                                // YYYY-MM-DD
    memo: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("sending"), v.literal("open"), v.literal("paid"), v.literal("void"), v.literal("uncollectible")),
    // What Stripe says about the money, kept from the webhook (cents).
    totalCents: v.number(), amountPaidCents: v.number(), amountRemainingCents: v.number(),
    processing: v.optional(v.boolean()),                // a bank payment is on its way
    lastFailure: v.optional(v.object({ at: v.number(), message: v.string(), key: v.optional(v.string()) })), // key: "<payment intent>:<charge>"
    // Step 3: the client's link to their invoice page (/i/<token>, in the invoice email) and the payments Stripe has
    // on the invoice (method shown as "Visa •••• 4242" or "Bank •••• 6789"; never full numbers).
    fromContract: v.optional(v.string()),                // "contract:<document>:v<n>": the deposit drafted when a contract was signed
    payToken: v.optional(v.string()),
    // Review fixes (Oct 30): a send in progress keeps what it has made in Stripe so far, so a failed send cleans up
    // and a retry neither duplicates nor gets stuck; syncedAt spaces out reads from Stripe.
    sendAttempt: v.optional(v.number()),
    pending: v.optional(v.object({ customerId: v.optional(v.string()), draftId: v.optional(v.string()), taxRateId: v.optional(v.string()) })),
    syncedAt: v.optional(v.number()),
    // Step 4: reminders sent (by hand or automatically), so the next one is worked out from what already went.
    reminders: v.optional(v.array(v.object({ at: v.number(), kind: v.union(v.literal("before"), v.literal("overdue")), auto: v.boolean() }))),
    payments: v.optional(v.array(v.object({ id: v.string(), at: v.number(), method: v.string(), cents: v.number(), status: v.union(v.literal("paid"), v.literal("processing"), v.literal("failed")), refundedCents: v.optional(v.number()) }))),
    refundedCents: v.optional(v.number()),
    disputed: v.optional(v.object({ at: v.number(), status: v.string(), cents: v.optional(v.number()), reason: v.optional(v.string()) })),
    stripe: v.optional(v.object({
      accountId: v.string(), invoiceId: v.string(), customerId: v.string(),
      number: v.optional(v.string()), hostedUrl: v.optional(v.string()), pdfUrl: v.optional(v.string()), livemode: v.boolean(),
    })),
    sendError: v.optional(v.string()),
    history: v.array(v.object({ kind: v.string(), at: v.number(), by: v.optional(v.string()), detail: v.optional(v.string()) })),
    createdBy: v.optional(v.string()),
    sentAt: v.optional(v.number()), viewedAt: v.optional(v.number()), paidAt: v.optional(v.number()), voidedAt: v.optional(v.number()),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_project", ["projectId"]).index("by_client", ["clientId"]).index("by_stripe", ["stripe.invoiceId"]).index("by_updated", ["updatedAt"]).index("by_pay_token", ["payToken"]).index("by_bill_email", ["billTo.email"]),

  // Phase 2 Part B: every Stripe webhook event, once (a repeat delivery changes nothing).
  stripeEvents: defineTable({
    eventId: v.string(), type: v.string(), account: v.optional(v.string()), livemode: v.boolean(), receivedAt: v.number(),
  }).index("by_event", ["eventId"]),

  // Phase 1 (Oct 29): the people at a client. Each one has a role, and portal access comes from their invite
  // (invites table): invited on a date, active once they made an account, or not invited.
  clientPeople: defineTable({
    businessId: v.optional(v.id("businesses")),
    clientId: v.id("clients"),
    email: v.string(),                 // lower-case
    name: v.optional(v.string()),
    role: v.union(v.literal("signer"), v.literal("contact")), // "Signs documents" / "Contact"
    createdAt: v.number(),
    removedAt: v.optional(v.number()),
  }).index("by_client", ["clientId"]).index("by_email", ["email"]),

  // Phase 1 (Oct 29): the Inbox. One row per person per event, so each person's read status is their own.
  // Every module posts through lib/inbox.ts; `key` makes each event post once per person, however often it runs.
  // Client approval (Phase 1): a signed-in client approved a version through a share. Deletes nothing; separate from
  // the owner's Approve final (videos.final).
  clientApprovals: defineTable({
    businessId: v.optional(v.id("businesses")),
    videoId: v.id("videos"),
    versionId: v.id("versions"),
    versionNumber: v.number(),
    userId: v.id("users"),
    name: v.string(),
    email: v.string(),
    shareId: v.id("shares"),
    at: v.number(),
  }).index("by_video", ["videoId", "at"]).index("by_version_user", ["versionId", "userId"]).index("by_at", ["at"]),
  inboxItems: defineTable({
    businessId: v.optional(v.id("businesses")),
    clientId: v.optional(v.id("clients")),
    email: v.string(),                 // the recipient, lower-case (a person with a live invite in this business)
    kind: v.union(v.literal("cut_ready"), v.literal("reply"), v.literal("to_sign"), v.literal("signed"), v.literal("cancelled"), v.literal("note"), v.literal("stage"), v.literal("final_files"), v.literal("invoice"), v.literal("payment"), v.literal("subscription")),
    title: v.string(),
    text: v.string(),                  // a short line, shown under the title
    link: v.optional(v.string()),      // a path in the portal or a signing link
    linkLabel: v.optional(v.string()), // a note's link button ("Watch Harbor Coffee 30s v2")
    source: v.object({ module: v.union(v.literal("review"), v.literal("sign"), v.literal("inbox"), v.literal("projects"), v.literal("payments")), id: v.string() }),
    key: v.string(),
    noteId: v.optional(v.id("inboxNotes")),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
    emailedAt: v.optional(v.number()),
  }).index("by_email", ["email", "createdAt"]).index("by_key", ["key"]).index("by_client", ["clientId", "createdAt"]).index("by_note", ["noteId"]),

  // Phase 1 (Oct 29): notes the owner posts to a client's Inbox. A draft (the owner's, or one Claude wrote through
  // the connector) does nothing until the owner sends it on the site. The Sent list reads this table.
  inboxNotes: defineTable({
    businessId: v.optional(v.id("businesses")),
    clientId: v.id("clients"),
    title: v.string(),
    text: v.string(),
    link: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("sent"), v.literal("discarded")),
    draftedBy: v.union(v.literal("owner"), v.literal("claude")),
    said: v.optional(v.string()),      // for a Claude draft: what Claude said Heston asked for
    to: v.optional(v.array(v.string())), // picked people (emails); missing = everyone at the client with portal access
    emailThem: v.optional(v.boolean()),  // "Also email them" (on by default; the emails arrive with the one-email switch)
    linkLabel: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    sentAt: v.optional(v.number()),
    recipients: v.optional(v.number()),
  }).index("by_status", ["status", "createdAt"]).index("by_client", ["clientId", "createdAt"]),

  memberships: defineTable({
    businessId: v.id("businesses"),
    email: v.string(),              // lower-case
    userId: v.optional(v.id("users")),
    role: v.union(v.literal("owner"), v.literal("client")),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  }).index("by_email", ["email"]).index("by_business_email", ["businessId", "email"]).index("by_user", ["userId"]),
});
