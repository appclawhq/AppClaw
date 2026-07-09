/**
 * Flow Generator Agent — uses ToolLoopAgent to generate YAML flows one at a time.
 *
 * Unlike the batch generateFlows() approach (single generateObject call for all flows),
 * this agent generates each flow independently via a save_flow tool, giving the LLM
 * full context of previously generated flows so each new one is meaningfully different.
 *
 * Used in Phase 3 of the Explorer pipeline (after PRD analysis and optional crawling).
 */

import { ToolLoopAgent, tool, isLoopFinished, stepCountIs } from 'ai';
import { z } from 'zod';
import type { PRDAnalysis, ScreenGraph, GeneratedFlow, ScreenshotData } from './types.js';

const FLOW_AGENT_INSTRUCTIONS = `You are a mobile test automation expert generating YAML flow files for AppClaw.

Each flow MUST follow this EXACT format:

\`\`\`yaml
# One-line comment describing what this flow does.
name: Descriptive flow name
---
- open <app name> app
- Click on Search Button
- Type "Appium 3.0" in the search bar
- Perform Search
- Scroll down 2 times until TestMu AI is visible
- done: "TestMu AI video for Appium 3.0 on YouTube is visible"
\`\`\`

The YAML has two documents separated by \`---\`:
- Document 1: metadata with \`name:\` field
- Document 2: a list of steps as natural language strings

Supported step patterns (use NATURAL LANGUAGE):
- open <app name> app              → Opens the app by name
- Click on <element>               → Taps a UI element
- Tap <element>                    → Same as click
- Type "<text>" in the <field>     → Types text. Text MUST be in quotes.
- Perform Search / Submit          → Presses Enter/Return
- Scroll down/up                   → Swipe gesture
- Scroll down N times until "X" is visible → Scroll+assert combo
- wait N s                         → Wait N seconds
- go back                          → Navigate back
- assert "X" is visible            → Verify text is on screen
- done: "message"                  → Mark flow complete

CRITICAL FORMAT RULES:
- Type steps MUST always quote the text: Type "search term" in the search bar
- Use natural language for ALL steps — never use structured YAML keys like tap:, type:, wait:
- Each flow MUST start with "open <app name> app"
- Each flow MUST end with done: "description of what was achieved"
- Each flow MUST be a complete, standalone user journey (5–15 steps)
- Flows MUST be diverse — do NOT generate similar flows

Your job:
1. Read the PRD analysis, screen data, and any screenshots in the user message
2. For each of the N flows requested, generate a distinct YAML flow and call save_flow
3. Prioritize high-priority journeys first, then medium, then low
4. If screenshots are provided, look at them carefully — use the EXACT button labels, text, and UI element names you can see
5. If screen graph data is available, use REAL element labels from it
6. Call save_flow once per flow. Stop when the tool returns remaining: 0`;

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string; mimeType: string };

function buildPromptParts(
  analysis: PRDAnalysis,
  numFlows: number,
  screenGraph?: ScreenGraph,
  screenshots?: ScreenshotData[]
): ContentPart[] {
  const journeyContext = analysis.userJourneys
    .sort((a, b) => {
      const priority = { high: 0, medium: 1, low: 2 };
      return priority[a.priority] - priority[b.priority];
    })
    .map(
      (j, i) =>
        `${i + 1}. [${j.priority}] ${j.name}: ${j.description}\n   Steps: ${j.steps.join(' → ')}`
    )
    .join('\n');

  const featureContext = analysis.features
    .map((f) => `- ${f.name}: ${f.description} (elements: ${f.expectedElements.join(', ')})`)
    .join('\n');

  let screenContext = '';
  if (screenGraph && screenGraph.screens.length > 0) {
    screenContext = '\n\n## Real Device Screen Data\n';
    screenContext += `Discovered ${screenGraph.screens.length} screens with ${screenGraph.transitions.length} transitions.\n\n`;

    for (const screen of screenGraph.screens) {
      screenContext += `### ${screen.id}\n`;
      if (screen.reachedVia) {
        screenContext += `Reached via: ${screen.reachedVia.action} from ${screen.reachedVia.fromScreen}\n`;
      }
      screenContext += `Visible texts: ${screen.visibleTexts.slice(0, 20).join(', ')}\n`;
      screenContext += `Tappable elements: ${screen.tappableElements.map((e) => `"${e.label}" (${e.type})`).join(', ')}\n\n`;
    }

    screenContext += '### Navigation Paths\n';
    for (const t of screenGraph.transitions) {
      screenContext += `- ${t.fromScreen} → tap "${t.element}" → ${t.toScreen}\n`;
    }

    screenContext +=
      '\nIMPORTANT: Use the REAL element labels from screen data above — they are the actual UI labels on the device.';
  }

  const hasScreenshots = screenshots && screenshots.length > 0;

  const textContent = `Generate exactly ${numFlows} YAML test flows for this mobile app. Call save_flow once for each flow.

## App: ${analysis.appName}
${analysis.appId ? `Package: ${analysis.appId}` : ''}
Platform: ${analysis.platform}

## Features
${featureContext}

## User Journeys (prioritized — pick the top ${numFlows})
${journeyContext}
${screenContext}
${hasScreenshots ? `\n## App Screenshots (${screenshots!.length} provided)\nThe screenshots below show the actual app UI. Use the EXACT button labels, text, and element names visible in them when writing flow steps.` : ''}

Generate ${numFlows} diverse flows. Include a mix of core happy-path flows, secondary feature flows, and at least one edge case if applicable.`;

  const parts: ContentPart[] = [{ type: 'text', text: textContent }];

  if (hasScreenshots) {
    for (const shot of screenshots!) {
      // Label each image so the agent knows which screen it's looking at
      parts.push({ type: 'text', text: `[Screenshot: ${shot.filename}]` });
      parts.push({ type: 'image', image: shot.base64, mimeType: shot.mimeType });
    }
  }

  return parts;
}

function buildYaml(name: string, comment: string, steps: string[]): string {
  const lines: string[] = [`# ${comment}`, `name: ${name}`, '---'];
  for (const step of steps) {
    lines.push(`- ${step}`);
  }
  const lastStep = steps[steps.length - 1];
  if (!lastStep?.toLowerCase().startsWith('done')) {
    lines.push('- done');
  }
  return lines.join('\n');
}

/**
 * Generate YAML flows using a ToolLoopAgent.
 *
 * The agent generates flows one at a time by calling save_flow for each,
 * giving it full context of what it has already generated so each new
 * flow is meaningfully different.
 */
export async function generateFlowsWithAgent(
  analysis: PRDAnalysis,
  numFlows: number,
  model: any,
  providerOptions?: Record<string, any>,
  screenGraph?: ScreenGraph,
  screenshots?: ScreenshotData[]
): Promise<GeneratedFlow[]> {
  const generatedFlows: GeneratedFlow[] = [];

  const agent = new ToolLoopAgent({
    model,
    instructions: FLOW_AGENT_INSTRUCTIONS,
    tools: {
      save_flow: tool({
        description:
          'Save a generated YAML test flow. Call this once per flow after composing its name, comment, and steps.',
        inputSchema: z.object({
          name: z
            .string()
            .describe(
              "Descriptive flow name (e.g. 'YouTube — search Appium 3.0 and verify TestMu AI video')"
            ),
          comment: z.string().describe('One-line comment placed at the top of the YAML file'),
          journey: z.string().describe('Which user journey this flow covers'),
          steps: z
            .array(z.string())
            .describe('Ordered natural language steps including the final done: step'),
        }),
        execute: async ({ name, comment, journey, steps }) => {
          generatedFlows.push({
            name,
            description: comment,
            yamlContent: buildYaml(name, comment, steps),
            journey,
          });

          const remaining = numFlows - generatedFlows.length;
          return {
            saved: true,
            flowsGenerated: generatedFlows.length,
            remaining,
          };
        },
      }),
    },
    // Stop when the agent makes a step with no tool calls (it's done)
    // or after a hard cap to prevent runaway loops
    stopWhen: [isLoopFinished(), stepCountIs(numFlows + 3)],
    ...(providerOptions ? { providerOptions } : {}),
  });

  const parts = buildPromptParts(analysis, numFlows, screenGraph, screenshots);

  // Use multimodal message format when screenshots are present, plain string otherwise
  const prompt =
    parts.length === 1 && parts[0].type === 'text'
      ? parts[0].text
      : [{ role: 'user' as const, content: parts }];

  await agent.generate({ prompt });

  return generatedFlows;
}
