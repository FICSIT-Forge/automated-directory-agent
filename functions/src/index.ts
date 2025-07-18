// Import the Genkit core libraries and plugins.
import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/googleai";

// Cloud Functions for Firebase supports Genkit natively. The onCallGenkit function creates a callable
// function from a Genkit action. It automatically implements streaming if your flow does.
// The https library also has other utility methods such as hasClaim, which verifies that
// a caller's token has a specific claim (optionally matching a specific value)
import { onCallGenkit } from "firebase-functions/https";

// Genkit models generally depend on an API key. APIs should be stored in Cloud Secret Manager so that
// access to these sensitive values can be controlled. defineSecret does this for you automatically.
// If you are using Google generative AI you can get an API key at https://aistudio.google.com/app/apikey
import { defineSecret } from "firebase-functions/params";
const apiKey = defineSecret("GEMINI_API_KEY");

// The Firebase telemetry plugin exports a combination of metrics, traces, and logs to Google Cloud
// Observability. See https://firebase.google.com/docs/genkit/observability/telemetry-collection.
import { enableFirebaseTelemetry } from "@genkit-ai/firebase";
enableFirebaseTelemetry();

const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model("gemini-2.5-flash"),
});

const adagentFlow = ai.defineFlow(
  {
    name: "adagentFlow",
  },
  async (question, { sendChunk }) => {
    // Construct prompt using prompts/adagent.prompt.
    const adagentPrompt = ai.prompt("adagent");

    // Construct a request and send it to the model API.
    const { response, stream } = adagentPrompt.stream({
      question: question,
    });

    for await (const chunk of stream) {
      sendChunk(chunk.text);
    }

    // Handle the response from the model API. In this sample, we just
    // convert it to a string, but more complicated flows might coerce the
    // response into structured output or chain the response into another
    // LLM call, etc.
    return (await response).text;
  },
);

export const adagent = onCallGenkit(
  {
    // Uncomment to enable AppCheck. This can reduce costs by ensuring only your Verified
    // app users can use your API. Read more at https://firebase.google.com/docs/app-check/cloud-functions
    // enforceAppCheck: true,

    // authPolicy can be any callback that accepts an AuthData (a uid and tokens dictionary) and the
    // request data. The isSignedIn() and hasClaim() helpers can be used to simplify. The following
    // will require the user to have the email_verified claim, for example.
    // authPolicy: hasClaim("email_verified"),

    // Grant access to the API key to this function:
    secrets: [apiKey],
    // cors: true,
  },
  adagentFlow,
);
