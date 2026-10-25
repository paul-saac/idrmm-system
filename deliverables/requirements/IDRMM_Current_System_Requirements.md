# IDRMM — Current System Requirements

Source-audit draft • 25 October 2026 • Working tree based on commit `d781c6c`

This document replaces the earlier broad requirements as a **draft description of the current implementation**. It was prepared from the current screens, server actions, calculation functions, and migration policies. It is not a claim that every workflow passed runtime testing or that the production database has every migration installed. The working tree, including local changes, takes precedence over the commit identifier.

The numbered requirements describe supported behavior. Appendix A explains data entry. Appendix B identifies discrepancies and retained functionality that must not be represented as completed mainstream workflows. Appendix C lists non-functional targets that still need agreement and testing. Appendix D supplies source traceability. No application behavior was changed for this document.

**Role terminology:** Administrator means the company administrator account. Super Administrator is the higher account-management role, sharing the administrator portal. The code does not require that its holder be a developer. “Administrative roles” means either of these roles. “Project-authorized user” means either administrative role or the Project Manager or Foreman assigned to that project. This term does not grant permission to restricted actions such as approving documents or deleting progress records.

## 3.1. Functional Requirements

### 3.1.1. Authenticate Users and Activate Invitations

REQ001. The system shall authenticate registered users using an email address and password.

REQ002. The system shall direct authenticated users to the portal associated with their assigned role.

REQ003. The system shall prevent inactive accounts from accessing protected application functions.

REQ004. The system shall require invited users to complete account activation before accessing protected application functions.

REQ005. The system shall allow an invited user to set and confirm a password of at least eight characters without choosing a different account role.

REQ006. The system shall allow a user to request a password-reset link using an email address.

REQ007. The system shall return a generic password-reset response that does not disclose whether an email address is registered.

REQ008. The system shall allow an authenticated user to change their password after verifying the current password and matching the new password confirmation.

REQ009. The system shall reject a password change when the new password matches the current password.

REQ010. The system shall allow users to sign out of their accounts.

REQ011. The system shall display the signed-in user's name, email address, and assigned role in Settings.

### 3.1.2. Manage Accounts and Role Permissions

REQ012. The system shall allow the Super Administrator to manage Administrator, Project Manager, and Foreman accounts.

REQ013. The system shall allow the Administrator to manage Project Manager and Foreman accounts.

REQ014. The system shall allow an authorized account manager to invite a user by entering a first name, last name, email address, and permitted role.

REQ015. The system shall reject an invitation when the email address already belongs to an existing account.

REQ016. The system shall allow an authorized account manager to resend an invitation to an eligible pending account.

REQ017. The system shall allow an authorized account manager to update the details of an account within their management scope.

REQ018. The system shall allow an authorized account manager to activate or deactivate eligible accounts individually or through bulk selection.

REQ019. The system shall prevent an account manager from deactivating their own account through account management.

REQ020. The system shall require a suitable replacement for a user assigned to an unfinished project before completing a deactivation that requires project handover.

REQ021. The system shall validate a handover replacement against the required role, active status, and project-assignment restrictions.

REQ022. The system shall allow an authorized account manager to change an eligible account to another role within their management scope.

REQ023. The system shall prevent role changes that conflict with the account's existing unfinished-project responsibilities.

REQ024. The system shall allow an authorized account manager to send a password-reset email, set an eligible account's temporary password, or revoke its sessions.

REQ025. The system shall restrict permanent account deletion to the Super Administrator and enforce the deletion action's account and assignment checks.

REQ026. The system shall display account details and recorded account-management activity to authorized account managers.

REQ027. The system shall restrict Project Manager and Foreman project access to their assigned projects.

REQ028. The system shall restrict the Accounts module to administrative roles.

REQ029. The system shall provide Team-module access to administrative roles and Project Managers.

REQ030. The system shall provide Dashboard, Projects, Inventory, Reports, and Settings access through the applicable role portal.

### 3.1.3. View the Dashboard and Project Portfolio

REQ031. The system shall display accessible projects with their current project status and progress.

REQ032. The system shall display dashboard counts of ongoing projects, completed projects, pending material requests, and pending equipment requests within the user's accessible scope.

REQ033. The system shall summarize active-project planned progress, current progress, allocated budget, recorded expenditure, and remaining budget when the required data is available.

REQ034. The system shall display pending requests with their project, request number, requester, request date, and priority.

REQ035. The system shall display recent project activity with navigation to its associated project or record.

REQ036. The system shall summarize team availability and equipment availability using the records accessible to the user.

### 3.1.4. Manage Project Information

REQ037. The system shall allow administrative roles to create a project with its name, location, planned start date, target completion date, allocated budget, Project Manager, and Foreman.

REQ038. The system shall require a project name, Project Manager, and Foreman when creating a project.

REQ039. The system shall reject project-management assignments that conflict with the implemented unfinished-project assignment restrictions.

REQ040. The system shall allow administrative roles to edit project information, including the actual completion date and project working days.

REQ041. The system shall allow administrative roles to delete a project through the project deletion action.

REQ042. The system shall distinguish the project's allocated budget from the planned costs calculated in its cost estimate.

REQ043. The system shall derive ongoing and completed project status from calculated project progress, subject to the current synchronization behavior.

REQ044. The system shall retain completed projects for viewing while their records remain stored in the system.

### 3.1.5. Manage Team Members and Work Groups

REQ045. The system shall organize Team members into Management, Skilled Workers, Engineers & Architects, and Subcontractors views.

REQ046. The system shall allow administrative roles to create and edit member records using names, role or trade, category, employment type, contact number, date hired, default hourly rate, and working-day hours as applicable.

REQ047. The system shall require a company name when a member is recorded as a subcontractor.

REQ048. The system shall accept nonnegative default hourly rates and daily working hours from zero to twenty-four for each day of the week.

REQ049. The system shall display a member's weekly working schedule, total weekly hours, groups, availability, and assignments.

REQ050. The system shall allow administrative roles to delete eligible member records while protecting account-linked management records from inappropriate Team deletion.

REQ051. The system shall allow Team users to search and filter member records.

REQ052. The system shall allow administrative roles and Project Managers to create, edit, and delete work groups.

REQ053. The system shall require a group name that is unique without regard to letter case.

REQ054. The system shall allow a work group to contain multiple selected members and a member to belong to multiple groups.

REQ055. The system shall allow project-authorized users to assign selected members to project tasks or standalone phases.

REQ056. The system shall derive member assignment information from recorded project and schedule assignments.

### 3.1.6. Prepare the Cost Estimate and Work Breakdown

REQ057. The system shall allow project-authorized users to create, edit, and delete construction categories or phases.

REQ058. The system shall allow project-authorized users to create and maintain tasks and supported subtasks within the project work breakdown.

REQ059. The system shall support a phase with no child tasks as an independently planned and tracked work item.

REQ060. The system shall allow users to maintain work-item names, estimated quantities, units, planned dates, priorities, milestone settings, and predecessor relationships through the applicable planning controls.

REQ061. The system shall allow users to maintain planned material, labor, equipment, and other cost components for work items.

REQ062. The system shall allow users to maintain planned material assignments with their quantities, units, and costs.

REQ063. The system shall allow users to maintain planned equipment and other cost breakdowns by description and amount.

REQ064. The system shall allow project-authorized users to set a default labor-cost percentage from zero to one hundred and apply the supported labor-estimate adjustments.

REQ065. The system shall calculate work-item cost totals from the applicable cost components and supported amount overrides.

REQ066. The system shall calculate work-item contributions to overall project progress using the implemented cost-weight allocation rules.

REQ067. The system shall display a breakdown explaining a work item's cost contribution and calculated weight.

REQ068. The system shall allow users to upload a supported BOM source file for extraction into a reviewable estimate draft.

REQ069. The system shall support PDF, supported image formats, CSV, and XLSX as BOM extraction inputs within the configured size limits.

REQ070. The system shall allow users to review the extracted categories, tasks, quantities, units, and materials before applying the import to a project.

REQ071. The system shall report an extraction error when the extraction service is unavailable or not configured.

### 3.1.7. Maintain the Schedule and Project Calendar

REQ072. The system shall display planned work-item durations and calculated progress on the project Gantt chart.

REQ073. The system shall display the current date in the schedule view.

REQ074. The system shall allow project-authorized users to update supported schedule fields through the schedule editing controls.

REQ075. The system shall provide supported schedule-item selection, deletion, and undo/redo operations.

REQ076. The system shall account for configured working days and holidays when calculating working-day-based expected progress.

REQ077. The system shall allow administrative roles to create, edit, and delete project holiday and meeting events.

REQ078. The system shall require an event type, event name, and event date when recording a project event.

REQ079. The system shall require a meeting's end time to be later than its start time.

REQ080. The system shall synchronize holiday events with the project's nonworking holiday dates.

### 3.1.8. Record Daily Task and Phase Progress

REQ081. The system shall allow project-authorized users to open a work item's progress view containing planned information, actual information, today's entry, and saved history.

REQ082. The system shall allow users to record completed quantity for a task or standalone phase in the work item's defined unit.

REQ083. The system shall allow users to record eligible skilled-employee attendance by selecting the worker and entering hours worked.

REQ084. The system shall calculate itemized labor cost using recorded hours and the worker's applicable master-list hourly rate.

REQ085. The system shall store the worker name and hourly-rate snapshot with the attendance record.

REQ086. The system shall reject duplicate worker selections within one attendance submission.

REQ087. The system shall reject a worker's attendance when it exceeds twenty-four hours for the same day across the checked assignments.

REQ088. The system shall allow users to record material usage by material, quantity, and unit.

REQ089. The system shall treat recorded material usage as stock usage without adding the purchase cost again to that progress entry.

REQ090. The system shall allow users to record planned and unplanned equipment expenditures by description and amount.

REQ091. The system shall allow users to record planned and unplanned other expenditures by description and amount.

REQ092. The system shall reject invalid or negative quantities and costs in the daily progress save action.

REQ093. The system shall save the current entry for a work item and date without a separate Project Manager approval stage.

REQ094. The system shall replace the current saved values when the same work item and date are saved again.

REQ095. The system shall retain supported progress-save history with its recorded date, saving user, and breakdown.

REQ096. The system shall restrict deletion of a saved progress entry to administrative roles.

REQ097. The system shall display a saved progress log in a read-only report modal containing its recorded work and expense breakdowns.

REQ098. The system shall display matching incident details and their available attachments directly within the progress-log report modal.

REQ099. The system shall allow users to download a daily progress-log PDF.

**Scope note:** The daily report is associated with the selected task or phase and log context. Do not describe it as a guaranteed consolidated report of every activity across the entire project on that day.

### 3.1.9. Calculate Progress and Schedule Position

REQ100. The system shall distinguish saved progress quantities and costs from automatically estimated progress for unlogged working days.

REQ101. The system shall calculate automatic progress using eligible elapsed working days and the remaining planned quantity or cost.

REQ102. The system shall prioritize quantity completion when calculating a work item's percentage where an estimated quantity exists.

REQ103. The system shall use the implemented cost or material-based fallback when quantity-based progress is unavailable.

REQ104. The system shall limit calculated work-item completion percentages to the range zero to one hundred.

REQ105. The system shall calculate overall project progress from weighted work-item completion, including independently tracked standalone phases.

REQ106. The system shall compare calculated actual and expected progress to identify ahead, on-track, or behind-schedule work using the implemented five-percentage-point tolerance.

### 3.1.10. Record Material Purchases and Monitor Stock

REQ107. The system shall allow project-authorized users to record material purchase batches for a purchase date.

REQ108. The system shall allow each purchase line to contain a supplier, optional invoice number, material name, quantity, unit, unit price, and recorded amount.

REQ109. The system shall validate purchase dates, required supplier and material details, positive quantities and amounts, and permitted numeric precision.

REQ110. The system shall allow users to attach supported receipt files to material purchase entries.

REQ111. The system shall use the saved purchase amount as the material expense amount.

REQ112. The system shall allow received quantity to be updated within the permitted purchased-quantity range.

REQ113. The system shall detect a conflicting received-quantity update using the expected previous value.

REQ114. The system shall allow project-authorized users to delete a material purchase record.

REQ115. The system shall calculate purchase-based stock balances from received quantities less recorded usage, grouped by normalized material name and unit.

REQ116. The system shall distinguish available, low-stock, out-of-stock, and over-issued purchase-based stock balances.

REQ117. The system shall display material records and usage details associated with project work items.

REQ118. The system shall support the existing separate manual material-record form with material name, specification, quantity, unit, and availability status where that view is exposed.

**Scope note:** Manual material records, request fulfillment, purchase receipts, and purchase-based stock are distinct records. Do not assume that changing one updates every other record or creates a purchase expense.

### 3.1.11. Process Material and Equipment Requests

REQ119. The system shall allow project-authorized users to submit material requests containing one or more requested items.

REQ120. The system shall allow project-authorized users to submit equipment requests containing one or more requested items.

REQ121. The system shall record each request's required date, priority, and remarks as supplied by the requester.

REQ122. The system shall record each request item's name, specification, requested quantity, unit, and purpose.

REQ123. The system shall assign a project-specific material or equipment request number.

REQ124. The system shall allow eligible requests to be edited or canceled under the request's current status restrictions.

REQ125. The system shall restrict request approval to administrative roles.

REQ126. The system shall allow project-authorized users to record eligible delivery quantities against request items.

REQ127. The system shall prevent recorded fulfillment from exceeding the permitted requested quantities.

REQ128. The system shall derive approved, partially fulfilled, and fulfilled request states from approval and item fulfillment while preserving submitted and canceled states.

REQ129. The system shall display request details, requested quantities, and fulfilled quantities in the associated project.

### 3.1.12. Manage Equipment Inventory and Movements

REQ130. The system shall allow administrative roles to create and maintain equipment inventory records with a name, category, description, serial number, and applicable status.

REQ131. The system shall assign an asset tag to an equipment inventory record.

REQ132. The system shall provide inventory viewing to Project Managers and Foremen without granting inventory-master editing privileges.

REQ133. The system shall allow administrative roles to assign inventory equipment to a project.

REQ134. The system shall allow project-authorized users to maintain permitted project-equipment assignment and return information.

REQ135. The system shall reject a recorded return date that precedes the assignment date.

REQ136. The system shall allow project-authorized users to maintain work-item equipment plans using available inventory equipment.

REQ137. The system shall record supported equipment planning, deployment, transfer, return, and usage operations with their project and work-item context.

REQ138. The system shall display equipment assignment, movement, and return information separately from equipment cost records.

### 3.1.13. Monitor Project Expenses

REQ139. The system shall consolidate current saved labor, equipment, and other progress expenses with recorded material purchase amounts.

REQ140. The system shall exclude automatic estimated progress costs from the recorded expense ledger.

REQ141. The system shall avoid treating repeated progress-save history as additional expenditure.

REQ142. The system shall display separate material, labor, equipment, and other expense breakdowns.

REQ143. The system shall preserve available itemized worker hours and rates, equipment descriptions, and other-cost descriptions in expense details.

REQ144. The system shall display actual recorded expense alongside the allocated budget and the planned estimate.

REQ145. The system shall calculate remaining allocated budget as allocated budget less recorded actual expense where a budget exists.

REQ146. The system shall allow supported expense records to open their associated read-only progress details.

### 3.1.14. Display Delay Risk and Completion Forecasts

REQ147. The system shall calculate Schedule Performance Index as earned value divided by planned value when planned value is positive.

REQ148. The system shall classify base delay risk as low for SPI of at least 0.95, medium for SPI of at least 0.85 but below 0.95, and high below 0.85.

REQ149. The system shall indicate insufficient information when a valid schedule-performance calculation is unavailable.

REQ150. The system shall apply the implemented risk escalation when at least three distinct approved legacy daily logs in the preceding thirty days contain a qualifying delay-related survey response.

REQ151. The system shall calculate a forecast completion date from the project's planned duration and positive SPI when the required dates are available.

REQ152. The system shall display the forecast's difference from the project's target completion date.

**Scope note:** This is a rules-based calculation, not a verified trained AI forecasting model. Current forecast aggregation and calendar assumptions differ from the main progress calculation; see Appendix B before accepting these requirements for UAT.

### 3.1.15. Submit and Review Project Documents

REQ153. The system shall allow project-authorized users to submit drawings, BOMs, cost estimates, specifications, and other project documents.

REQ154. The system shall record a document's reference number, title, category, discipline, stage, and uploaded file.

REQ155. The system shall support original, revision, and as-built document stages, with as-built restricted to drawings.

REQ156. The system shall require change notes for a revision or as-built submission.

REQ157. The system shall accept supported PDF, PNG, and JPEG document files within the eight-megabyte limit per file.

REQ158. The system shall assign document revision information and retain submission and review history.

REQ159. The system shall allow external approval details to be recorded as a complete set of approver name, role, approval date, and supporting evidence.

REQ160. The system shall allow the main signed document to serve as approval evidence when the corresponding option is selected.

REQ161. The system shall reject an external approval date in the future.

REQ162. The system shall restrict internal document review to administrative roles.

REQ163. The system shall allow an administrative reviewer to accept a document, request changes, or reject it with the required review notes.

REQ164. The system shall reject a stale document-review submission when its expected review state no longer matches the stored state.

REQ165. The system shall provide authorized access to stored document files and approval evidence.

### 3.1.16. Record and Review Safety Incidents

REQ166. The system shall allow project-authorized users to open the incident form from a task or phase progress view.

REQ167. The system shall allow the user to classify an incident as injury, near miss, equipment damage, property damage, or other.

REQ168. The system shall allow the user to classify severity as minor, moderate, or serious.

REQ169. The system shall require an incident description and allow an optional location.

REQ170. The system shall automatically record the current Manila date and time for a new incident rather than requiring date and time input in the current form.

REQ171. The system shall associate an incident with its project, task or phase, reporting user, and log-date context.

REQ172. The system shall allow up to five JPG, PNG, or PDF incident attachments, subject to a ten-megabyte individual limit and fifteen-megabyte combined limit.

REQ173. The system shall save an incident independently of the progress entry's quantity and costs.

REQ174. The system shall display saved incidents within the matching today's-log incident section.

REQ175. The system shall display an incident's details and available attachments in its centered viewing modal.

REQ176. The system shall allow project-authorized users to delete an incident through the incident deletion control.

REQ177. The system shall notify other eligible active administrative users and assigned project supervisors when an incident is reported.

### 3.1.17. Manage Punch-List Items

REQ178. The system shall allow project-authorized users to create and update a project's punch-list items.

REQ179. The system shall record issue type, responsible trade or party, area, specific location, date identified, description, action person, and current status from the active punch-list form.

REQ180. The system shall require the issue's area, description, and valid identification date.

REQ181. The system shall restrict the action-person selection to the project's assigned Project Manager or Foreman, or leave the item unassigned.

REQ182. The system shall allow supported photo or video evidence up to fifty megabytes to accompany a punch-list item.

REQ183. The system shall allow an item to be marked open or closed using the active form.

REQ184. The system shall record the closing user and timestamp when an item is saved as closed and clear that closure information when it is reopened.

### 3.1.18. Manage Quality Inspections

REQ185. The system shall allow project-authorized users to create and update quality inspection records.

REQ186. The system shall record inspection type, work inspected, area or location, inspection date, inspector name, organization, result, and findings or remarks.

REQ187. The system shall require work inspected, area or location, inspection date, and inspector name.

REQ188. The system shall provide architectural, structural, electrical, plumbing, mechanical, fire-safety, materials, and other inspection classifications.

REQ189. The system shall provide pending, passed, failed, conditional, and reinspection-required inspection results.

REQ190. The system shall allow optional test information consisting of test name, required result, actual result, and result unit.

REQ191. The system shall allow an inspection to reference an accepted supporting document belonging to the same project.

REQ192. The system shall reject a supporting-document link that does not satisfy the project and acceptance requirements.

**Scope note:** The active inspection form does not require accreditation numbers, professional licenses, a linked task, or a linked punch-list item. It records a result chosen by the user; it does not independently determine code compliance from the test text.

### 3.1.19. Generate Reports and Maintain Closeout Notes

REQ193. The system shall allow users to select an accessible project and generate a supported report from its centralized records.

REQ194. The system shall provide Project Closeout, Punch List, As-built, Final Financial and Job Cost, Quality Assurance and Inspection Sign-off, and Safety and Incident Closeout report types.

REQ195. The system shall allow users to specify a report title.

REQ196. The system shall allow date filtering for report types that expose a date range and reject invalid or reversed ranges.

REQ197. The system shall allow section selection for Project Closeout, As-built, and Financial reports.

REQ198. The system shall allow supported milestone or document-register column selection in the applicable report types.

REQ199. The system shall generate supported PDF and spreadsheet report exports.

REQ200. The system shall allow project-authorized users to maintain closeout narratives for summary, outcomes, cost explanation, performance, scope changes, operations and maintenance, lessons, and designated approver names.

REQ201. The system shall allow recorded achievement dates for valid project milestones and reject future achievement dates.

REQ202. The system shall preserve stored narrative fields that are hidden by the current closeout-section selection.

REQ203. The system shall reject a closeout save when another save has changed its expected version.

REQ204. The system shall summarize original and final as-built document records, revisions, field changes, and recorded approvals in the As-built report.

REQ205. The system shall generate punch-list report details from recorded issue, location, responsible-party, status, and evidence information.

REQ206. The system shall provide financial sections for the final cost summary, planned versus actual cost types, materials, labor, equipment, other costs, categories, and tasks.

REQ207. The system shall filter financial actual transactions by their recorded dates while retaining the full planned baseline when a financial date range is selected.

REQ208. The system shall calculate financial cost variance as planned cost minus actual cost and distinguish under-planned, on-plan, and over-planned expenditure.

REQ209. The system shall generate the combined Quality Assurance and Inspection Sign-off report using inspection summaries, recorded test results, and linked supporting documents.

REQ210. The system shall generate the Safety and Incident Closeout report using recorded incident counts, severity and type summaries, incident details, and an evidence register.

REQ211. The system shall state that no recorded incidents is a statement about system records rather than independent certification of zero accidents.

REQ212. The system shall disclose that the current safety report does not establish incident resolution, corrective-action completion, or final regulatory safety approval.

### 3.1.20. Manage Notifications

REQ213. The system shall display notifications addressed to the signed-in user.

REQ214. The system shall allow users to filter supported notification views by read state and the available date periods.

REQ215. The system shall display a notification's message, related project context, and timestamp.

REQ216. The system shall allow users to mark their notifications read or unread.

REQ217. The system shall allow users to mark all their notifications as read.

REQ218. The system shall allow users to delete their own notifications.

REQ219. The system shall update the unread indicator after supported read-state changes.

REQ220. The system shall navigate from a supported notification to the associated accessible project context.

## 3.2. Non-functional Requirements

These requirements express constraints evidenced by the implementation. Their presence in source does not substitute for role, usability, recovery, or deployment testing. Performance and availability targets that cannot be established from the repository are separated into Appendix C.

### 3.2.1. Operational Requirements

REQ221. The system shall operate as a browser-based application using the configured application and database services.

REQ222. The system shall keep service credentials required by privileged server operations out of browser-delivered application configuration.

REQ223. The system shall use the configured mail and extraction services for invitation delivery, password-reset delivery, and BOM extraction respectively.

### 3.2.2. Security and Access Requirements

REQ224. The system shall check the authenticated user's authorization in protected server operations rather than relying only on hidden interface controls.

REQ225. The system shall apply the database's configured row-level policies to protected user and project records.

REQ226. The system shall limit notification mutations to the signed-in recipient's notifications.

REQ227. The system shall store project-sheet files and incident evidence in their configured private storage locations and provide authorized, time-limited access.

REQ228. The system shall validate supported file signatures and file sizes in the project-document and incident-upload actions before accepting files.

**Qualification:** REQ227 does not describe all storage buckets. Purchase receipts and punch-list evidence currently use public URLs. A universal claim that every uploaded file is private would be inaccurate.

### 3.2.3. Data Integrity and Consistency Requirements

REQ229. The system shall validate numeric input according to the relevant form's permitted ranges and precision before accepting protected saves.

REQ230. The system shall associate a saved task or phase progress entry with one work item and one entry date.

REQ231. The system shall maintain the saved attendance rate snapshot independently of later changes to the worker's master rate.

REQ232. The system shall distinguish current financial transactions from repeated progress history when aggregating actual expenses.

REQ233. The system shall detect stale updates for the implemented version-checked closeout, document-review, received-quantity, and equipment-plan operations.

REQ234. The system shall display validation or save errors for unsuccessful protected operations rather than representing them as completed saves.

**Qualification:** There is no verified universal transaction guarantee. Some multi-record saves and optional receipt uploads have partial-save or fallback paths. See Appendix B.

### 3.2.4. Usability and Presentation Requirements

REQ235. The system shall identify required inputs and display validation feedback in the applicable data-entry forms.

REQ236. The system shall use the existing dialog controls to separate record viewing from editing where dedicated read-only views are implemented.

REQ237. The system shall present financial amounts using the system's Philippine peso formatting.

REQ238. The system shall present source context such as project, task or phase, record date, and saving user where those details are available in the applicable record view.

REQ239. The system shall provide responsive layout or scrolling behavior for the screens and tables that implement those controls.

**Qualification:** These are implementation-backed presentation constraints, not proof of complete mobile usability or accessibility-standard conformance. Full Foreman mobile usability remains a UAT task.

### 3.2.5. Traceability and Maintainability Requirements

REQ240. The system shall preserve the implemented account, document-review, and progress-history records needed to identify supported changes and their authors.

REQ241. The system shall maintain database changes through versioned migration files.

REQ242. The system shall keep report calculations traceable to their project records and distinguish entered narrative content from calculated totals.

## Appendix A. Data-entry guide

“Required” below identifies the principal required inputs confirmed in the reviewed actions or forms. It is not a replacement for field-level validation testing. Automatically assigned identifiers and timestamps are not inputs that the user must type.

| Entry | Inputs and their purpose | Automatically supplied or derived |
|---|---|---|
| Account invitation | First and last names identify the user; email receives the invitation; permitted role determines access. All are required. | Account identifier, invitation state, inviting manager, event history. |
| Invitation activation | New password and confirmation establish the invited user's login. | Role remains the invitation's assigned role. |
| Password change | Current password verifies the user; new password and confirmation set the replacement. | Authentication outcome. |
| Account handover | Replacement account for each affected running project transfers the departing user's responsibility. | Replacement eligibility and affected-project checks. |
| Project | Name identifies the job; location identifies the site; start and target dates define the schedule boundary; allocated budget is the company's spending allocation; PM and Foreman assign responsibility. Name and both assignments are required. | Project identifier and calculated status. |
| Project edit | Actual end date records completion; working days define eligible weekdays in the project schedule, in addition to the project fields above. | Holiday dates can be synchronized from calendar events. |
| Team member | Names identify the person; category separates the member type; role/trade describes their work; employment type distinguishes employees and subcontractors; company identifies a subcontractor; contact and hired date supply reference details; rate and daily hours support labor planning and attendance. | Weekly hours and assignment-derived availability. |
| Work group | Group name identifies the crew; description explains it; selected members define membership. | Membership counts. |
| Phase/task | Name identifies work; quantity and unit define measurable output; dates define its plan; priority identifies urgency; predecessor and milestone settings describe scheduling relationships. Cost components describe planned expenditure. | Totals, weights, expected and calculated progress. |
| Material estimate | Material, quantity, unit, and unit-cost/amount fields define the planned material allowance for work. | Applicable extended costs and work-item totals. |
| Labor estimate | Worker assignments and supported rate/percentage controls establish the labor plan. | Calculated labor allowance and cost contribution. |
| Equipment/other estimate | Description identifies a planned cost; amount sets its allowance. | Summed component cost. |
| BOM import | Source file supplies the draft; reviewed extracted categories, tasks, materials, quantities, units, and costs become the import input. | Extraction results; nothing should be represented as approved merely because extraction succeeded. |
| Calendar event | Type is holiday or meeting; name describes it; date locates it; meeting start/end times define duration. | Holiday synchronization and display. |
| Daily quantity | Completed quantity records the selected work item's output for that log date. | Work-item unit, author, saved date/time, calculated progress. |
| Daily labor | Worker selection identifies who worked; hours record attendance. | Master-list rate snapshot and hours-times-rate amount. Subcontractor hourly attendance is currently rejected despite its picker tab. |
| Daily materials | Material, usage quantity, and unit describe stock consumed. | Stock balance impact; no additional material purchase expense. |
| Daily equipment/other cost | Existing planned item or unplanned description identifies the expenditure; amount records the cost. | Itemized and aggregate daily totals. Equipment movement is a separate entry. |
| Material purchase | Purchase date dates the transaction. Each line has supplier, optional invoice, material, quantity, unit, unit price, and amount; optional receipt provides evidence. | Initial received quantity and purchase expense record. The recorded amount is an explicit value; do not assume it is always enforced as quantity multiplied by unit price. |
| Received quantity | Updated quantity records how much of the purchase has arrived. | Range and expected-previous-value checks. |
| Manual material record | Name, specification, quantity, unit, and manually chosen status describe the separate material record. | Material code. This is not itself the purchase-based cost ledger. |
| Material/equipment request | Required date indicates need; routine/urgent/emergency indicates priority; remarks provide context. Each item has name, specification, quantity, unit, and purpose. | Request number, requester, date, initial state. |
| Request delivery | Fulfilled quantities update the eligible request lines. | Partial/full fulfillment status. A delivery is not automatically a billed purchase. |
| Inventory equipment | Name identifies the asset; category groups it; serial number identifies the physical unit; description supplies details; allowed status describes availability. | Asset tag and assignment information. |
| Equipment assignment/movement | Project or destination, equipment, task/phase where applicable, movement type, date, and notes describe placement and use. Assignment/return controls use their applicable dates and purpose. | Current movement/assignment state. No operating-hours or idle-hours ledger is established by these forms. |
| Document submission | Reference, title, document category, discipline, stage, and main file identify the document. Change notes explain revisions/as-built submissions. | Revision and review history; submitting user. |
| External approval evidence | Approver name, role, approval date, and evidence record an approval obtained outside the system. Use the signed-main-document option where applicable. | Evidence linkage. This does not independently verify the person's authority. |
| Document review | Decision and required notes record the administrator's internal review. | Reviewer, timestamp, optimistic conflict check. |
| Incident | Type classifies the event; severity expresses the reporter's assessment; location is optional; description states what happened; photos/PDFs provide evidence. | Current Manila occurrence date/time, reporter, project and work context. There is no current corrective-action or resolution-status input. |
| Punch-list item | Issue type names the defect; trade identifies responsibility; area and specific location locate it; identified date dates it; description explains it; evidence illustrates it; action person selects the PM/Foreman; status is open/closed. | Display title derived from issue type; closure user/time. Priority defaults in a hidden field; due date and task link are not current visible inputs. |
| Quality inspection | Type classifies the inspection; required work, area, date, and inspector identify it; organization identifies the inspecting party; result is selected; remarks describe findings. | Project linkage and inspection identifier. |
| Inspection test | Test name identifies the test; required result records the criterion; actual result records the observed result; unit supplies its measurement unit. All are optional in the simplified form. | Report test-results section; no automatic pass/fail evaluation of free text. |
| Inspection evidence | Supporting-document selection links an already accepted project document. Upload and review that document in the document workflow first. | Same-project and accepted-status checks. |
| Closeout notes | Narrative fields explain outcomes, costs, performance, changes, maintenance, and lessons; approver-name fields record names; milestone dates record achievement. | Version checks and generated sections. Typed names are not a verified digital-signature workflow. |
| Report generation | Project chooses source data; type chooses format; title names output; exposed dates, sections, and columns control the selection. | Calculated totals, source tables, generated metadata and export. |

## Appendix B. Current discrepancies and boundaries

These observations belong in the review record, not hidden inside “shall” statements that make defects look intentional.

1. **Today's progress is not the legacy Daily Logs workflow.** Current task/category entries save directly. The older `daily_log_*` workflow has approval and flagging actions restricted to administrative roles. Its parent Progress tab is currently hidden from the normal main-tab bar, although retained routes/URL state can expose legacy views. Do not describe the current Foreman-to-PM process as “submit, then PM validates” without implementing that process.

2. **Subcontractor selection conflicts with attendance validation.** The workforce picker offers subcontractors, but the current attendance-save validation allows skilled employees and rejects subcontractor hourly attendance. The message directs subcontractor expenditure to other costs. Decide the desired business rule and align the picker and save action before UAT.

3. **Progress includes automatic estimates.** A project can show progress for eligible days without a saved daily accomplishment entry. “Actual progress” therefore does not mean exclusively verified, manually recorded physical accomplishment. This also affects project completion status.

4. **Material purchases and usage are separate.** The current expense reader uses purchase amounts and explicitly ignores progress-entry material cost. Usage reduces stock; it does not charge the purchase twice. Manual material records and request-delivery records should not be assumed to feed the purchase-based stock calculation automatically.

5. **Project material costs are not allocated to tasks by purchase entry.** Purchases have purchase-specific keys rather than task/category keys in the expense reader. Financial task/category breakdowns consequently need reconciliation with project-level material totals; they are not proof that every purchase has been assigned to a particular job-cost item.

6. **Filtered financial reports retain the full plan.** The selected dates filter actual recorded transactions, not a prorated planned baseline. Label and explain that comparison during UAT; an under-planned result for a short period is not necessarily a project saving.

7. **Financial reporting is cost reporting.** There is no verified final-billing, receivables, unbilled-revenue, profit-margin, or subcontractor-payment ledger in the reviewed report path. Do not include those as working financial-report requirements merely because the original client description mentioned them.

8. **Forecasting uses different assumptions.** The current forecasting function iterates tasks for planned/earned value, while main progress also supports standalone phases. Forecast planned value uses calendar-time fractions, whereas main expected progress uses working days. Its qualitative risk escalation reads approved legacy delay-survey logs, not the new incident records. Its actual-cost input also comes from the legacy approved-daily-log expense summary, which can differ from the current purchase/progress expense ledger. These differences require explicit reconciliation before forecasting is accepted as a consistent system-wide measure.

9. **Legacy Daily Logs remain in source.** Retained administrative forms/actions include work quantities and activities; labor roles, headcounts, daily rates, overtime and half-day counts; expenses and additional fees; material-use status; procurement; equipment acquisitions; attachments; and survey answers. They also include status changes and entry flag/resolve/reflag operations. This is a separate legacy coverage area, not the normal today's-log entry specification. If the client still needs it, explicitly include it in the UAT scope after confirming how users will reach it.

10. **Safety closeout is a records summary.** Current incidents do not capture treatment, lost time, root cause, corrective actions, resolution, or regulatory approval. No-recorded-incidents statements cannot establish a zero-accident certification. The generated report already discloses these limits.

11. **Inspection evidence is recorded, not issued by the application.** The combined quality report records inspections, tests, and supporting documents. It does not issue authority certificates or verify accreditation. The result is selected by a user, not computed from textual test criteria.

12. **Some older schema fields are not active form inputs.** Punch priority/due-date/task links and older quality accreditation/certificate fields must not appear as required user inputs merely because columns exist.

13. **Attachment privacy is not uniform.** Project sheets and incident evidence use private storage access. Purchase receipts and punch-list evidence use public URLs in the reviewed actions. A blanket sensitive-file privacy requirement would need further implementation and deployment verification.

14. **Not every save is atomic.** Progress entries and their child rows use multiple writes. Optional receipt upload failure can allow a purchase to save without a receipt. Conflict protection exists in selected operations, not universally. Do not promise zero partial saves, zero duplicates, or zero data loss from source inspection alone.

15. **Completed records are not an immutable archive.** Completed projects remain stored and viewable, but there is no demonstrated archival lock, approved retention schedule, or automatic model-training pipeline. Administrative deletion still exists.

16. **Role permissions are fixed in code and policies.** There is no verified Super Administrator feature-per-account permission designer. The Super Administrator's higher account privileges do not mean that every feature has a separate customization switch.

17. **Deployment remains unverified.** The audit does not establish which migrations are installed in the live database, whether email delivery works, whether external extraction credentials are configured, or whether every storage policy matches its repository definition.

## Appendix C. Non-functional targets still requiring agreement

These are **not confirmed current-system capabilities** and are deliberately excluded from the numbered implementation-backed baseline. Agree on them with the client, then assign requirement identifiers and test cases. A meaningful target needs a device/network, dataset, workload, measurement method, and pass threshold.

| Area | Decision and verification needed |
|---|---|
| Response time | Identify which pages and saves must meet a threshold, the dataset size, the network, and whether the measurement is first load or subsequent use. Test percentile response times; do not claim every page loads in two seconds from code inspection. |
| Concurrent use | Agree on the number of simultaneous Foremen, PMs, and administrators and their actions. Run representative load tests. |
| Availability | Agree on the hosting environment, monitoring window, excluded maintenance, and uptime target. Repository code cannot prove 99.9% availability. |
| Recovery | Agree on backup frequency, retention, maximum acceptable lost work, and maximum restoration time. Perform a restoration test. |
| Mobile usability | Have Foremen complete representative daily entries and evidence uploads on their actual phones, browsers, and site networks. Record completion rate, errors, and assistance needed. |
| Accessibility | Agree on keyboard, focus, screen-reader, contrast, and zoom expectations, then test the actual screens. Do not assert standards certification without assessment. |
| Encryption/privacy | Verify production HTTPS, storage encryption, key handling, bucket visibility, and access policies. Resolve the public-evidence exceptions before promising universal confidentiality. |
| Data consistency | Test simultaneous editing, failed uploads, interrupted multi-table saves, repeated submissions, and retries. Define the required recovery behavior. |
| Capacity | Agree on project count, members, daily entries, attachment volume, and retention period; test representative capacity. |
| Browser support | Name the browser/device versions the client actually uses, then run the agreed workflows there. |

## Appendix D. Source traceability and review coverage

### Role summary

This summarizes the reviewed access rules rather than introducing new permissions. PM and Foreman project actions are limited to their assigned projects. Company Team and Inventory visibility have separate rules and must not be described as entirely project-isolated.

| Function | Super Administrator | Administrator | Project Manager | Foreman |
|---|---|---|---|---|
| Manage accounts | Admin, PM, Foreman | PM, Foreman | No | No |
| Permanently delete eligible accounts | Yes | No | No | No |
| Create/edit/delete project information | Yes | Yes | No | No |
| Edit estimates and supported schedules | Yes | Yes | Assigned project | Assigned project |
| Save current task/phase progress | Yes | Yes | Assigned project | Assigned project |
| Delete saved progress entries | Yes | Yes | No | No |
| Edit Team member master records | Yes | Yes | No | No |
| View Team / manage work groups | Yes | Yes | Yes | No Team page |
| Edit inventory master | Yes | Yes | View only | View only |
| Submit material/equipment requests | Yes | Yes | Assigned project | Assigned project |
| Approve requests | Yes | Yes | No | No |
| Submit project documents | Yes | Yes | Assigned project | Assigned project |
| Review project documents | Yes | Yes | No | No |
| Record purchases, incidents, punch items, inspections | Yes | Yes | Assigned project | Assigned project |
| Generate supported reports | Yes | Yes | Accessible projects | Accessible projects |
| Manage holiday/meeting events | Yes | Yes | View | View |

### Evidence map

Paths are relative to the repository root. Each group identifies the primary sources reviewed; database behavior also depends on the relevant migration chain being deployed. This matrix is a starting point for linking future UAT cases to requirement IDs.

| Requirement range | Primary implementation evidence |
|---|---|
| REQ001–REQ030 | `lib/auth/roles.ts`, `session.ts`, `actions.ts`, `invitation-actions.ts`, `save-setup-password.ts`, `project-access.ts`; `lib/accounts/actions.ts`; portal routes and layouts; `components/settings/settings-view.tsx` |
| REQ031–REQ036 | `lib/dashboard/data.ts`; dashboard components; project access filtering |
| REQ037–REQ044 | `lib/projects/actions.ts`, `data.ts`, `status.ts`, `sync.ts`; create/edit project forms |
| REQ045–REQ056 | `lib/workers/actions.ts`, `data.ts`, `sections.ts`, schedule helpers; `components/team/`; member-group policies |
| REQ057–REQ071 | `lib/cost-estimate/actions.ts`, `data.ts`, `weights.ts`; `components/projects/cost-estimate/`; `lib/bom-import/actions.ts` |
| REQ072–REQ080 | Gantt/schedule components; `lib/cost-estimate/undo-redo-actions.ts`; `lib/project-events/actions.ts`, `types.ts`; project working-day/holiday policies |
| REQ081–REQ106 | `lib/task-progress/actions.ts`, `calculate.ts`; `lib/category-progress/actions.ts`; attendance helpers; progress-tracking components; `lib/progress/data.ts`; `lib/progress-logs/` |
| REQ107–REQ118 | `lib/materials/purchase-actions.ts`, purchases and stock helpers, `actions.ts`; project material forms and views |
| REQ119–REQ129 | `lib/material-requests/actions.ts`, `status.ts`; `lib/equipment-requests/actions.ts`, `status.ts`; request forms and detail views |
| REQ130–REQ138 | `lib/equipment/actions.ts`, `data.ts`, `tracking-actions.ts`, tracking types; Inventory and project-equipment components |
| REQ139–REQ146 | `lib/equipment/data.ts` (`listProgressExpenses`); `components/projects/project-detail-page.tsx`, `project-detail-view.tsx`; expense-view components |
| REQ147–REQ152 | `lib/forecasting/data.ts`, `status.ts`; project progress/risk display components |
| REQ153–REQ165 | `lib/sheets/actions.ts`, `model.ts`; document submission/review components and file routes |
| REQ166–REQ177 | `lib/incidents/actions.ts`, `model.ts`; incident form/detail components; incident storage and notification migrations |
| REQ178–REQ184 | `components/reports/punch-list-manager.tsx`; `lib/reports/punch-list-actions.ts`, `punch-list-model.ts` |
| REQ185–REQ192 | `components/reports/quality-inspection-manager.tsx`; `lib/reports/quality-inspection-actions.ts`, inspection model |
| REQ193–REQ212 | Report-builder components; `lib/reports/generated-report.ts`, `closeout-data.ts`, `closeout-model.ts`, `closeout-actions.ts`; PDF/spreadsheet exporters |
| REQ213–REQ220 | `lib/notifications/actions.ts`, `link.ts`; `components/notifications/` |
| REQ221–REQ242 | Authentication/client separation, server actions, storage/file routes, form validation, migration policies, optimistic version checks, history readers, and exporters cited above |
| Legacy boundary | `lib/daily-logs/actions.ts`, `data.ts`; `components/projects/daily-logs/`; hidden Progress-tab routing in `project-detail-view.tsx` |

### Review status

- Completed: source-based examination of current routes, principal data-entry forms/actions, role checks, report-generation paths, progress/cost calculations, and relevant policy definitions.
- Completed: separation of ordinary user-entered values, calculated values, retained legacy fields, and unsupported claims.
- Not performed for this document: live database inspection, production-policy verification, complete browser execution, email-delivery testing, concurrency/load testing, accessibility certification, or disaster-recovery testing.
- Next acceptance step: review the numbered requirements and Appendix B with the client, resolve conflicting business rules, then build UAT cases linked to the approved requirement IDs and tester roles.
