# Azure Foundry connection for IDRMM AI features

Azure support is configured server-side for **Import with AI** and **AI Project
Insights**. No Azure resource or model deployment is created by this code. Student
eligibility, model availability, quota and pricing must be confirmed in the Azure
account before enabling it. Hosting the website in Azure does not create an AI
deployment automatically.

## 1. Create an eligible model deployment

1. Open https://ai.azure.com/ and sign in with the Azure student account.
2. Inspect Model catalog and available deployment options under that subscription.
   Confirm that the model and deployment type accept your credit; do not assume
   that every partner/Marketplace offer is eligible.
3. Choose a text chat model and review its pricing, region, token limits and quota.
   Only create the deployment after those details are understood.
4. Copy the **resource/model endpoint**, **deployment name** and API key from
   the deployment's consumption/code example. Keep the API key private.

The implementation supports Azure's model-inference chat API and compatible
Foundry OpenAI v1 chat-completions deployments. Select the same API surface as
the model's generated example. A Foundry portal URL or project URL is not the
model resource endpoint. Examples below are fictional, not provisioned resources.

## 2. Add server settings

Append these settings to the local ignored `.env` for development. Add the same
settings under Azure App Service > Environment variables for the deployed app.
Keep existing Supabase, site, backup and Groq settings intact.

The GitHub deployment workflow can also apply these settings using its existing
Azure identity: store `AZURE_AI_API_KEY` as an encrypted Actions repository secret
and the other `AI_PROVIDER` / `AZURE_AI_*` values as Actions repository variables.
When `AI_PROVIDER=azure-foundry`, the workflow applies only the AI settings after
deployment. Supabase and backup settings are untouched. The key is passed through
a private temporary file, removed afterwards, and is never logged. To rotate it,
update the encrypted secret and rerun deployment. To manage settings manually
instead, remove the `AI_PROVIDER` repository variable to skip that workflow step.

```dotenv
AI_PROVIDER=azure-foundry
AZURE_AI_ENDPOINT=https://YOUR-RESOURCE.services.ai.azure.com
AZURE_AI_API_KEY=YOUR-PRIVATE-KEY
AZURE_AI_MODEL=YOUR-DEPLOYMENT-NAME
```

For inference API examples using `/models/chat/completions`, the defaults are:

```dotenv
AZURE_AI_API_STYLE=inference
AZURE_AI_API_VERSION=2024-05-01-preview
AZURE_AI_RESPONSE_FORMAT=json_object
AZURE_AI_MAX_OUTPUT_TOKENS=4096
```

If the deployment's example uses `/openai/v1/chat/completions`, set
`AZURE_AI_API_STYLE=openai` instead. Root endpoints ending in `.openai.azure.com`
and endpoints already containing `/openai/v1` automatically select that API.
There is no dated `api-version` query on this v1 path. Use the deployment name
accepted by the generated example as `AZURE_AI_MODEL`.

Do not prefix any API key with `NEXT_PUBLIC_`. Azure's Value field should not
include surrounding quotation marks. Restart the development server after `.env`
changes, or Apply settings in Azure (which restarts the app).

The default JSON-object mode suits deployments without strict schema support.
Use `AZURE_AI_RESPONSE_FORMAT=json_schema` only when supported by the selected
deployment, or `text` if neither JSON response mode is supported. JSON-only system
instructions and local output validation remain active in every mode. A bounded
fallback handles explicitly rejected JSON modes; it never switches vendors.

The output cap defaults to 4096 tokens and may be set from 256 to 8192, within
the model's own supported limit. Import may require smaller document sections
when the output is too long. Existing upload/context bounds are unchanged.

## 3. Image imports

Text-based PDFs, CSV and XLSX files are extracted locally and sent as text.
Images need an image-capable deployment. Configure its exact deployment name:

```dotenv
AZURE_AI_VISION_MODEL=YOUR-IMAGE-CAPABLE-DEPLOYMENT-NAME
```

That deployment must be available through the same resource endpoint/key/API
style. A multimodal deployment may be the same name as the text deployment if
it supports both. Without this setting, image requests stop before sending file
contents and explain that a vision deployment is required. Scanned PDFs still
need page images; this change does not add PDF OCR or create a vision model.

## 4. Verify before changing production

1. Test Import with AI using a small non-sensitive CSV or text PDF.
2. Review its returned draft, names, quantities, units and material lines.
   Extraction does not create or edit tasks until the existing Apply action.
3. Test AI Project Insights on a project the signed-in account may access.
   Findings use authorized server facts and saved progress/costs, and do not
   update project records. Existing navigation and permissions remain intact.
4. Check actual model usage/cost in Azure and verify limits before broader use.
5. Deploy the intended code files through the existing GitHub workflow, then add
   the production Azure settings and repeat a small test.

Leaving `AI_PROVIDER` unset (or setting it to `groq`) retains the original Groq
configuration. Selecting Azure with missing settings fails explicitly; the app
does not silently send a document/project context to Groq as a fallback.

Tests use fictional endpoints, mocked responses and no live customer records.
A successful automated test does not establish that the student subscription
has Azure model access. A live API test is still required after provisioning.

## Troubleshooting

- **401/403:** verify the endpoint/key pair and deployment access.
- **404:** verify the endpoint API style and exact deployed model name.
- **429:** review quota, rate limits and available credit; retry later.
- **400:** check model support for JSON mode, image input and output-token cap.
- **Incomplete import:** split the document into smaller sections; truncated
  output is rejected instead of accepted as a partial complete import.

Official API references:
- https://learn.microsoft.com/en-us/rest/api/microsoftfoundry/model-inference/get-chat-completions/get-chat-completions?view=rest-microsoftfoundry-model-inference-2024-05-01-preview
- https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/chat
- https://azure.microsoft.com/en-us/free/students/
