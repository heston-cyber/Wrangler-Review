/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as approvals from "../approvals.js";
import type * as home from "../home.js";
import type * as portal from "../portal.js";
import type * as invoicePay from "../invoicePay.js";
import type * as invoiceReminders from "../invoiceReminders.js";
import type * as brandKit from "../brandKit.js";
import type * as crm from "../crm.js";
import type * as quotes from "../quotes.js";
import type * as leads from "../leads.js";
import type * as plans from "../plans.js";
import type * as subscriptionClock from "../subscriptionClock.js";
import type * as subscriptions from "../subscriptions.js";
import type * as invoices from "../invoices.js";
import type * as payments from "../payments.js";
import type * as projects from "../projects.js";
import type * as auth from "../auth.js";
import type * as bunny from "../bunny.js";
import type * as clients from "../clients.js";
import type * as shares from "../shares.js";
import type * as emails from "../emails.js";
import type * as lib_shareAccess from "../lib/shareAccess.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_viewer from "../lib/viewer.js";
import type * as lib_email from "../lib/email.js";
import type * as connector from "../connector.js";
import type * as crons from "../crons.js";
import type * as dropbox from "../dropbox.js";
import type * as diag from "../diag.js";
import type * as emailTest from "../emailTest.js";
import type * as finalTest from "../finalTest.js";
import type * as http from "../http.js";
import type * as library from "../library.js";
import type * as mcp from "../mcp.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_dropboxPath from "../lib/dropboxPath.js";
import type * as lib_edl from "../lib/edl.js";
import type * as lib_frames from "../lib/frames.js";
import type * as lib_mp4 from "../lib/mp4.js";
import type * as lib_mp4audio from "../lib/mp4audio.js";
import type * as lib_peaks from "../lib/peaks.js";
import type * as lib_waveformDecode from "../lib/waveformDecode.js";
import type * as lib_transcript from "../lib/transcript.js";
import type * as lib_voice from "../lib/voice.js";
import type * as notes from "../notes.js";
import type * as og from "../og.js";
import type * as phase0 from "../phase0.js";
import type * as player from "../player.js";
import type * as prefs from "../prefs.js";
import type * as r1test from "../r1test.js";
import type * as r1results from "../r1results.js";
import type * as register from "../register.js";
import type * as reviewFiles from "../reviewFiles.js";
import type * as reviewTest from "../reviewTest.js";
import type * as scrubCheck from "../scrubCheck.js";
import type * as signTest from "../signTest.js";
import type * as smoke from "../smoke.js";
import type * as lib_bunnySign from "../lib/bunnySign.js";
import type * as lib_media from "../lib/media.js";
import type * as lib_reviewStorage from "../lib/reviewStorage.js";
import type * as lib_register from "../lib/register.js";
import type * as slack from "../slack.js";
import type * as stills from "../stills.js";
import type * as testdata from "../testdata.js";
import type * as transcribe from "../transcribe.js";
import type * as transcripts from "../transcripts.js";
import type * as stillsDb from "../stillsDb.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";
import type * as views from "../views.js";
import type * as waveform from "../waveform.js";
import type * as waveforms from "../waveforms.js";
import type * as sign from "../sign.js";
import type * as signing from "../signing.js";
import type * as lib_wsSigning from "../lib/wsSigning.js";
import type * as signDone from "../signDone.js";
import type * as wsMcp from "../wsMcp.js";
import type * as builder from "../builder.js";
import type * as lib_wsBuilder from "../lib/wsBuilder.js";
import type * as lib_wsStarter from "../lib/wsStarter.js";
import type * as wsConnector from "../wsConnector.js";
import type * as wsNode from "../wsNode.js";
import type * as wsRender from "../wsRender.js";
import type * as lib_wsPageMd from "../lib/wsPageMd.js";
import type * as lib_wsPdfImport from "../lib/wsPdfImport.js";
import type * as lib_pngCheck from "../lib/pngCheck.js";
import type * as lib_mcpServer from "../lib/mcpServer.js";
import type * as lib_wsMarkers from "../lib/wsMarkers.js";
import type * as wsArchive from "../wsArchive.js";
import type * as lib_wsFinal from "../lib/wsFinal.js";
import type * as wsS0 from "../wsS0.js";
import type * as lib_wsAudit from "../lib/wsAudit.js";
import type * as lib_wsLayout from "../lib/wsLayout.js";
import type * as lib_wsPdf from "../lib/wsPdf.js";
import type * as business from "../business.js";
import type * as inbox from "../inbox.js";
import type * as documents from "../documents.js";
import type * as lib_inbox from "../lib/inbox.js";
import type * as lib_business from "../lib/business.js";
import type * as lib_owners from "../lib/owners.js";
import type * as lib_site from "../lib/site.js";
import type * as migrations from "../migrations.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_tenancy from "../lib/tenancy.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  approvals: typeof approvals;
  home: typeof home;
  portal: typeof portal;
  invoicePay: typeof invoicePay;
  invoiceReminders: typeof invoiceReminders;
  brandKit: typeof brandKit;
  crm: typeof crm;
  quotes: typeof quotes;
  leads: typeof leads;
  plans: typeof plans;
  subscriptionClock: typeof subscriptionClock;
  subscriptions: typeof subscriptions;
  invoices: typeof invoices;
  payments: typeof payments;
  projects: typeof projects;
  auth: typeof auth;
  bunny: typeof bunny;
  clients: typeof clients;
  shares: typeof shares;
  emails: typeof emails;
  "lib/shareAccess": typeof lib_shareAccess;
  "lib/hash": typeof lib_hash;
  "lib/viewer": typeof lib_viewer;
  "lib/email": typeof lib_email;
  connector: typeof connector;
  crons: typeof crons;
  dropbox: typeof dropbox;
  diag: typeof diag;
  emailTest: typeof emailTest;
  finalTest: typeof finalTest;
  http: typeof http;
  library: typeof library;
  mcp: typeof mcp;
  "lib/access": typeof lib_access;
  "lib/dropboxPath": typeof lib_dropboxPath;
  "lib/edl": typeof lib_edl;
  "lib/frames": typeof lib_frames;
  "lib/mp4": typeof lib_mp4;
  "lib/mp4audio": typeof lib_mp4audio;
  "lib/peaks": typeof lib_peaks;
  "lib/waveformDecode": typeof lib_waveformDecode;
  "lib/transcript": typeof lib_transcript;
  "lib/voice": typeof lib_voice;
  notes: typeof notes;
  og: typeof og;
  phase0: typeof phase0;
  player: typeof player;
  prefs: typeof prefs;
  r1test: typeof r1test;
  r1results: typeof r1results;
  register: typeof register;
  reviewFiles: typeof reviewFiles;
  reviewTest: typeof reviewTest;
  scrubCheck: typeof scrubCheck;
  signTest: typeof signTest;
  smoke: typeof smoke;
  "lib/bunnySign": typeof lib_bunnySign;
  "lib/media": typeof lib_media;
  "lib/reviewStorage": typeof lib_reviewStorage;
  "lib/register": typeof lib_register;
  slack: typeof slack;
  stills: typeof stills;
  testdata: typeof testdata;
  transcribe: typeof transcribe;
  transcripts: typeof transcripts;
  stillsDb: typeof stillsDb;
  uploads: typeof uploads;
  business: typeof business;
  inbox: typeof inbox;
  documents: typeof documents;
  "lib/inbox": typeof lib_inbox;
  "lib/business": typeof lib_business;
  "lib/owners": typeof lib_owners;
  "lib/site": typeof lib_site;
  migrations: typeof migrations;
  "lib/functions": typeof lib_functions;
  "lib/tenancy": typeof lib_tenancy;
  users: typeof users;
  views: typeof views;
  waveform: typeof waveform;
  waveforms: typeof waveforms;
  sign: typeof sign;
  signing: typeof signing;
  "lib/wsSigning": typeof lib_wsSigning;
  signDone: typeof signDone;
  wsMcp: typeof wsMcp;
  builder: typeof builder;
  "lib/wsBuilder": typeof lib_wsBuilder;
  "lib/wsStarter": typeof lib_wsStarter;
  wsConnector: typeof wsConnector;
  wsNode: typeof wsNode;
  wsRender: typeof wsRender;
  "lib/wsPageMd": typeof lib_wsPageMd;
  "lib/wsPdfImport": typeof lib_wsPdfImport;
  "lib/pngCheck": typeof lib_pngCheck;
  "lib/mcpServer": typeof lib_mcpServer;
  "lib/wsMarkers": typeof lib_wsMarkers;
  wsArchive: typeof wsArchive;
  "lib/wsFinal": typeof lib_wsFinal;
  wsS0: typeof wsS0;
  "lib/wsAudit": typeof lib_wsAudit;
  "lib/wsLayout": typeof lib_wsLayout;
  "lib/wsPdf": typeof lib_wsPdf;
}>;

export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
