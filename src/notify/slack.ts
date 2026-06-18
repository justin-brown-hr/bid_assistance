type SlackApiResponse = {
  ok: boolean;
  error?: string;
};

type SlackOAuthResponse = {
  ok: boolean;
  error?: string;
  authed_user?: {
    id: string;
    access_token: string;
  };
};

type SlackAuthTestResponse = {
  ok: boolean;
  error?: string;
  user?: string;
  user_id?: string;
};

export type SlackOAuthExchange = {
  userToken: string;
  userId: string;
};

function slackApiErrorMessage(error: string | undefined): string {
  if (error === "missing_scope") {
    return "Slack app needs User Token Scope: chat:write";
  }
  if (error === "not_in_channel") {
    return "Join #Good Job in Slack first, then try again";
  }
  if (error === "channel_not_found") {
    return "SLACK_CHANNEL_ID is invalid";
  }
  if (error === "token_revoked" || error === "invalid_auth") {
    return "Slack connection expired — connect Slack again in Profile";
  }
  return error || "Slack API request failed";
}

export async function exchangeSlackUserToken(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<SlackOAuthExchange> {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }),
  });
  const json = (await res.json()) as SlackOAuthResponse;
  if (!json.ok || !json.authed_user?.access_token || !json.authed_user.id) {
    throw new Error(slackApiErrorMessage(json.error) || "Slack OAuth failed");
  }
  return {
    userToken: json.authed_user.access_token,
    userId: json.authed_user.id,
  };
}

export async function fetchSlackUserDisplayName(userToken: string): Promise<string> {
  const res = await fetch("https://slack.com/api/auth.test", {
    headers: { authorization: `Bearer ${userToken}` },
  });
  const json = (await res.json()) as SlackAuthTestResponse;
  if (!json.ok) return "";
  return json.user?.trim() ?? "";
}

/** Posts as the signed-in Slack user — message can be deleted like a normal user message. */
export async function postSlackMessageAsRealUser(opts: {
  userToken: string;
  channelId: string;
  text: string;
}): Promise<void> {
  const text = opts.text.trim();
  if (!text) throw new Error("Project URL is required");

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${opts.userToken}`,
    },
    body: JSON.stringify({
      channel: opts.channelId,
      text,
      unfurl_links: true,
      unfurl_media: true,
    }),
  });
  const json = (await res.json()) as SlackApiResponse;
  if (!json.ok) {
    throw new Error(slackApiErrorMessage(json.error));
  }
}

export async function sendSlackProjectLink(opts: {
  projectUrl: string;
  userToken: string;
  channelId: string;
}): Promise<void> {
  const channelId = opts.channelId.trim();
  if (!channelId) throw new Error("SLACK_CHANNEL_ID is not configured");

  await postSlackMessageAsRealUser({
    userToken: opts.userToken,
    channelId,
    text: opts.projectUrl,
  });
}
