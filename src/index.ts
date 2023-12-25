import { App, type LinkUnfurls, type MessageAttachment } from "@slack/bolt";
import { config } from "dotenv";
import { isNotUndefined } from "typesafe-utils";

config();

const app = new App({
  token: process.env.SLACK_BOT_USER_OAUTH_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,

  customRoutes: [
    {
      path: "/health-check",
      method: ["GET"],
      handler: (req, res) => {
        res.writeHead(200);
        res.end(`Things are going just fine at ${req.headers.host}!`);
      },
    },
  ],
});

(async () => {
  await app.start(process.env.PORT || 3000);

  console.log("⚡️ Bolt app is running!");
})();

app.event("link_shared", async ({ event, client, logger }) => {
  try {
    const unfurlsEntries = (
      await Promise.all(
        event.links.map(
          async (link): Promise<[string, MessageAttachment] | undefined> => {
            const url = new URL(link.url);
            const paths = url.pathname.split("/");
            // /orgs/{orgName}/alerts/{alertId}
            if (
              paths.length === 5 &&
              paths[1] === "orgs" &&
              paths[3] === "alerts" &&
              paths[4] !== ""
            ) {
              try {
                const res = await fetch(
                  `https://api.mackerelio.com/api/v0/alerts/${paths[4]}`,
                  {
                    headers: {
                      "X-Api-Key": process.env.MACKEREL_API_KEY ?? "",
                    },
                  }
                );
                const alert = await res.json();
                let color: string = "";
                switch (alert.status) {
                  case "OK":
                    color = "#71DD23";
                    break;
                  case "CRITICAL":
                    color = "#FF3E4B";
                    break;
                  case "UNKNOWN":
                    color = "#9500FF";
                    break;
                  case "WARNING":
                    color = "#FAC800";
                    break;
                }
                let text = `Status: ${alert.status}\nOpenedAt: ${alert.openedAt}`;
                if (alert.message !== undefined) {
                  text = text.concat(`\nMessage: ${alert.message}`);
                }
                const messageAttachment: MessageAttachment = {
                  color,
                  blocks: [
                    {
                      type: "section",
                      text: {
                        type: "mrkdwn",
                        text,
                      },
                    },
                  ],
                };
                return [link.url, messageAttachment];
              } catch (error) {
                logger.error(error);
                return undefined;
              }
            } else {
              return undefined;
            }
          }
        )
      )
    ).filter(isNotUndefined);
    if (unfurlsEntries.length === 0) return;

    const unfurls: LinkUnfurls = Object.fromEntries(unfurlsEntries);
    client.chat.unfurl({
      ts: event.message_ts,
      channel: event.channel,
      unfurls: unfurls,
    });
  } catch (error) {
    logger.error(error);
  }
});
