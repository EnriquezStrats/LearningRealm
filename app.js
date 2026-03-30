console.log("Supabase client:", supabaseClient);

// =========================
// GLOBAL STATE
// =========================
let currentStudent = null;
let currentTeacher = null;

const BASIC_PACK_COST = 150;

const QUESTS = [
    {
        id: "quest_1",
        title: "Sample Quest",
        instructions: "Write 3 sentences using new vocabulary.",
        rewardText: "100 Knowledge + 1 Basic Pack",
        rewardKnowledge: 100,
        rewardPacks: 1,
        bonusRewardKnowledge: 0,
        bonusRewardPacks: 0
    }
];

let selectedQuestId = null;
let selectedTeacherSubmission = null;


// =========================
// HELPERS
// =========================
function getEl(id) {
    return document.getElementById(id);
}

function showScreen(screenId) {
    document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
    getEl(screenId)?.classList.remove("hidden");
}

function getStudentStorageKey(classCode, studentName) {
    return `student_${classCode}_${studentName}`;
}


// =========================
// LOGIN / NAV
// =========================
function showTeacherLogin() {
    showScreen("teacher-login-screen");
}

function showStudentLogin() {
    showScreen("login-screen");
}

async function enterWorld() {
    const classCode = getEl("classCode").value.trim().toUpperCase();
    const studentName = getEl("studentName").value.trim().toUpperCase();
    const studentPassword = getEl("studentPassword")?.value.trim();

    getEl("login-error").textContent = "";

    if (!classCode || !studentName || !studentPassword) {
        getEl("login-error").textContent = "Enter class code, name, and password.";
        return;
    }

    const { data: classRow, error: classError } = await supabaseClient
        .from("classes")
        .select("id, class_code")
        .eq("class_code", classCode)
        .single();

    if (classError || !classRow) {
        getEl("login-error").textContent = "Class not found.";
        return;
    }

    const { data: studentRow, error: studentError } = await supabaseClient
        .from("students")
        .select("id, student_name, password_hash, knowledge, basic_packs")
        .eq("class_id", classRow.id)
        .eq("student_name", studentName)
        .single();

    if (studentError || !studentRow) {
        getEl("login-error").textContent = "Student not found.";
        return;
    }

    if ((studentRow.password_hash || "").trim() !== studentPassword.trim()) {
        getEl("login-error").textContent = "Incorrect password.";
        return;
    }

    currentStudent = {
        id: studentRow.id,
        name: studentRow.student_name,
        classCode: classRow.class_code,
        knowledge: studentRow.knowledge || 0,
        packs: { basic: studentRow.basic_packs || 0 },
        ownedCards: [],
        questSubmissions: loadStudentSubmissions(classRow.class_code, studentRow.student_name)
    };

    updateHubUI();
    clearSelectedQuestDisplay();
    await renderQuestList();
    showScreen("hub-screen");
}

function studentLogout() {
    currentStudent = null;
    selectedQuestId = null;
    getEl("login-error").textContent = "";
    showScreen("login-screen");
}

function teacherLogout() {
    currentTeacher = null;
    selectedTeacherSubmission = null;
    clearTeacherSelectedSubmission();
    getEl("teacher-login-error").textContent = "";
    showScreen("login-screen");
}

async function enterTeacherDashboard() {
    const classCode = getEl("teacherClassCode").value.trim().toUpperCase();
    const teacherName = getEl("teacherName").value.trim().toUpperCase();
    const passcode = getEl("teacherPasscode").value.trim();

    getEl("teacher-login-error").textContent = "";

    const teacher = CLASS_TEACHERS[classCode];

    if (!teacher || teacher.teacherName !== teacherName || teacher.passcode !== passcode) {
        getEl("teacher-login-error").textContent = "Invalid teacher login.";
        return;
    }

    currentTeacher = { classCode, teacherName };

    getEl("displayTeacherName").textContent = teacherName;
    getEl("displayTeacherClass").textContent = classCode;

    clearTeacherSelectedSubmission();
    await renderTeacherSubmissionList();
    await renderTeacherRoster();
    await renderTeacherQuestList();

    showScreen("teacher-dashboard-screen");
}

async function openQuestScreen() {
    await renderQuestList();
    clearSelectedQuestDisplay();
    showScreen("quest-screen");
}

function returnHub() {
    if (currentStudent) {
        updateHubUI();
        showScreen("hub-screen");
    } else {
        showScreen("login-screen");
    }
}


// =========================
// LOCAL SUBMISSION STORAGE
// =========================
function loadStudentSubmissions(classCode, studentName) {
    const key = getStudentStorageKey(classCode, studentName);
    const data = JSON.parse(localStorage.getItem(key));

    if (!data) return {};

    return data.questSubmissions || {};
}

function saveStudentData() {
    if (!currentStudent) return;

    const key = getStudentStorageKey(currentStudent.classCode, currentStudent.name);
    localStorage.setItem(key, JSON.stringify({
        name: currentStudent.name,
        classCode: currentStudent.classCode,
        knowledge: currentStudent.knowledge,
        packs: currentStudent.packs,
        ownedCards: currentStudent.ownedCards || [],
        questSubmissions: currentStudent.questSubmissions || {}
    }));
}


// =========================
// STUDENT QUESTS (SUPABASE)
// =========================
async function getAvailableQuestsForStudent() {
    if (!currentStudent) return QUESTS;

    const { data: classRow, error: classError } = await supabaseClient
        .from("classes")
        .select("id")
        .eq("class_code", currentStudent.classCode)
        .single();

    if (classError || !classRow) {
        console.error("Could not load class for student quests:", classError);
        return QUESTS;
    }

    const { data: quests, error: questError } = await supabaseClient
        .from("quests")
        .select("*")
        .eq("class_id", classRow.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

    if (questError) {
        console.error("Could not load student quests:", questError);
        return QUESTS;
    }

    if (!quests || quests.length === 0) {
        return QUESTS;
    }

    return quests.map(quest => ({
        id: quest.id,
        title: quest.title,
        instructions: quest.instructions,
        rewardText: `${quest.reward_knowledge} Knowledge + ${quest.reward_packs} Pack(s)`,
        rewardKnowledge: quest.reward_knowledge,
        rewardPacks: quest.reward_packs,
        bonusRewardKnowledge: quest.bonus_reward_knowledge || 0,
        bonusRewardPacks: quest.bonus_reward_packs || 0
    }));
}

async function renderQuestList() {
    const list = getEl("quest-list");
    if (!list || !currentStudent) return;

    list.innerHTML = "";

    const quests = await getAvailableQuestsForStudent();

    quests.forEach(q => {
        const submission = currentStudent.questSubmissions?.[q.id];
        const status = submission ? submission.status : "Not Submitted";

        const btn = document.createElement("button");
        btn.style.display = "block";
        btn.style.width = "100%";
        btn.style.marginBottom = "8px";
        btn.textContent = `${q.title} (${status})`;
        btn.onclick = () => selectQuest(q.id);

        list.appendChild(btn);
    });
}

async function selectQuest(id) {
    selectedQuestId = id;

    const quests = await getAvailableQuestsForStudent();
    const quest = quests.find(q => q.id === id);
    if (!quest) return;

    const submission = currentStudent.questSubmissions?.[quest.id];
    const status = submission ? submission.status : "Not Submitted";
    const submissionText = submission ? submission.text : "";
    const teacherNote = submission?.teacherNote || "";

    getEl("selectedQuestTitle").textContent = quest.title;
    getEl("selectedQuestInstructions").textContent = quest.instructions;
    getEl("selectedQuestReward").textContent = `Reward: ${quest.rewardText}`;
    getEl("selectedQuestStatus").textContent = `Status: ${status}`;
    getEl("questSubmissionBox").value = submissionText;
    getEl("questSubmissionMessage").textContent = "";

    const submitButton = getEl("submitQuestButton");
    const claimRewardButton = getEl("claimRewardButton");
    const submissionBox = getEl("questSubmissionBox");

    if (claimRewardButton) {
        claimRewardButton.classList.add("hidden");
        claimRewardButton.disabled = true;
    }

    if (status === "Pending Review" || status === "Reward Claimed") {
        submissionBox.disabled = true;
        submitButton.disabled = true;
    } else if (
        status === "Approved - Reward Ready" ||
        status === "Approved with Bonus - Reward Ready"
    ) {
        submissionBox.disabled = true;
        submitButton.disabled = true;

        if (claimRewardButton) {
            claimRewardButton.classList.remove("hidden");
            claimRewardButton.disabled = false;
        }
    } else {
        submissionBox.disabled = false;
        submitButton.disabled = false;
    }

    if (teacherNote) {
        getEl("questSubmissionMessage").textContent = `Teacher Note: ${teacherNote}`;
    }
}

function clearSelectedQuestDisplay() {
    selectedQuestId = null;

    getEl("selectedQuestTitle") && (getEl("selectedQuestTitle").textContent = "Select a Quest");
    getEl("selectedQuestInstructions") && (getEl("selectedQuestInstructions").textContent = "Quest instructions will appear here.");
    getEl("selectedQuestReward") && (getEl("selectedQuestReward").textContent = "Reward: --");
    getEl("selectedQuestStatus") && (getEl("selectedQuestStatus").textContent = "Status: --");

    const box = getEl("questSubmissionBox");
    if (box) {
        box.value = "";
        box.disabled = false;
    }

    const submitButton = getEl("submitQuestButton");
    if (submitButton) {
        submitButton.disabled = false;
    }

    const claimRewardButton = getEl("claimRewardButton");
    if (claimRewardButton) {
        claimRewardButton.classList.add("hidden");
        claimRewardButton.disabled = true;
    }

    const msg = getEl("questSubmissionMessage");
    if (msg) {
        msg.textContent = "";
    }
}

async function submitQuestForReview() {
    alert("submit function started");

    if (!currentStudent || !selectedQuestId) {
        alert("missing student or selected quest");
        return;
    }

    const text = getEl("questSubmissionBox").value.trim();
    const messageEl = getEl("questSubmissionMessage");

    if (!text) {
        alert("no submission text entered");
        messageEl.textContent = "Please enter your submission.";
        return;
    }

    const { data, error } = await supabaseClient
        .from("submissions")
        .insert([
            {
                quest_id: selectedQuestId,
                student_id: currentStudent.id,
                submission_text: text,
                status: "Pending Review",
                teacher_note: "",
                reward_claimed: false,
                bonus_claimed: false
            }
        ])
        .select();

    if (error) {
        alert("Supabase insert failed");
        console.error(error);
        messageEl.textContent = "Could not submit right now.";
        return;
    }

    alert("Supabase insert worked");

    currentStudent.questSubmissions[selectedQuestId] = {
        text: text,
        status: "Pending Review",
        teacherNote: "",
        rewardClaimed: false,
        bonusClaimed: false
    };

    saveStudentData();
    await renderQuestList();
    await selectQuest(selectedQuestId);

    messageEl.textContent = "Submitted for review!";
}

async function claimQuestReward() {
    if (!currentStudent || !selectedQuestId) return;

    const messageEl = getEl("questSubmissionMessage");
    if (messageEl) {
        messageEl.textContent = "";
    }

    const submissions = await loadStudentSubmissionsFromSupabase();
    const submission = submissions[selectedQuestId];

    if (!submission) {
        if (messageEl) {
            messageEl.textContent = "No submission found for this quest.";
        }
        return;
    }

    const quests = await getAvailableQuestsForStudent();
    const quest = quests.find(q => q.id === selectedQuestId);

    if (!quest) {
        if (messageEl) {
            messageEl.textContent = "Quest not found.";
        }
        return;
    }

    if (
        submission.status !== "Approved - Reward Ready" &&
        submission.status !== "Approved with Bonus - Reward Ready"
    ) {
        if (messageEl) {
            messageEl.textContent = "This reward is not ready to claim.";
        }
        return;
    }

    let knowledgeToAdd = 0;
    let packsToAdd = 0;

    if (!submission.rewardClaimed) {
        knowledgeToAdd += quest.rewardKnowledge || 0;
        packsToAdd += quest.rewardPacks || 0;
    }

    if (submission.status === "Approved with Bonus - Reward Ready" && !submission.bonusClaimed) {
        knowledgeToAdd += quest.bonusRewardKnowledge || 0;
        packsToAdd += quest.bonusRewardPacks || 0;
    }

    const newKnowledge = (currentStudent.knowledge || 0) + knowledgeToAdd;
    const newBasicPacks = (currentStudent.packs?.basic || 0) + packsToAdd;

    const { error: studentUpdateError } = await supabaseClient
        .from("students")
        .update({
            knowledge: newKnowledge,
            basic_packs: newBasicPacks
        })
        .eq("id", currentStudent.id);

    if (studentUpdateError) {
        console.error("Student reward update error:", studentUpdateError);
        if (messageEl) {
            messageEl.textContent = "Could not claim reward right now.";
        }
        return;
    }

    const submissionUpdate = {
        status: "Reward Claimed",
        reward_claimed: true,
        bonus_claimed: submission.status === "Approved with Bonus - Reward Ready" ? true : submission.bonusClaimed
    };

    const { error: submissionUpdateError } = await supabaseClient
        .from("submissions")
        .update(submissionUpdate)
        .eq("quest_id", selectedQuestId)
        .eq("student_id", currentStudent.id);

    if (submissionUpdateError) {
        console.error("Submission reward update error:", submissionUpdateError);
        if (messageEl) {
            messageEl.textContent = "Reward was added, but submission status failed to update.";
        }
        return;
    }

    currentStudent.knowledge = newKnowledge;
    currentStudent.packs.basic = newBasicPacks;
    currentStudent.questSubmissions = await loadStudentSubmissionsFromSupabase();

    saveStudentData();
    updateHubUI();
    await renderQuestList();
    await selectQuest(selectedQuestId);

    if (messageEl) {
        messageEl.textContent = "Rewards claimed successfully!";
    }
}


// =========================
// TEACHER QUESTS (SUPABASE)
// =========================
async function createTeacherQuest() {
    if (!currentTeacher) return;

    const title = getEl("teacher-quest-title").value.trim();
    const instructions = getEl("teacher-quest-instructions").value.trim();
    const knowledge = parseInt(getEl("teacher-quest-knowledge").value) || 0;
    const packs = parseInt(getEl("teacher-quest-packs").value) || 0;
    const bonusKnowledge = parseInt(getEl("teacher-quest-bonus-knowledge")?.value) || 0;
    const bonusPacks = parseInt(getEl("teacher-quest-bonus-packs")?.value) || 0;
    const messageEl = getEl("teacher-quest-message");

    if (messageEl) {
        messageEl.textContent = "";
    }

    if (!title || !instructions) {
        if (messageEl) {
            messageEl.textContent = "Please enter a title and instructions.";
        }
        return;
    }

    const { data: classRow, error: classError } = await supabaseClient
        .from("classes")
        .select("id")
        .eq("class_code", currentTeacher.classCode)
        .single();

    if (classError || !classRow) {
        if (messageEl) {
            messageEl.textContent = "Could not find class.";
        }
        console.error("Class lookup error:", classError);
        return;
    }

    const { error: insertError } = await supabaseClient
        .from("quests")
        .insert([
            {
                class_id: classRow.id,
                title: title,
                instructions: instructions,
                reward_knowledge: knowledge,
                reward_packs: packs,
                bonus_reward_knowledge: bonusKnowledge,
                bonus_reward_packs: bonusPacks,
                is_active: true
            }
        ]);

    if (insertError) {
        if (messageEl) {
            messageEl.textContent = "Could not create quest.";
        }
        console.error("Quest insert error:", insertError);
        return;
    }

    getEl("teacher-quest-title").value = "";
    getEl("teacher-quest-instructions").value = "";
    getEl("teacher-quest-knowledge").value = 100;
    getEl("teacher-quest-packs").value = 1;

    const bonusKnowledgeEl = getEl("teacher-quest-bonus-knowledge");
    const bonusPacksEl = getEl("teacher-quest-bonus-packs");

    if (bonusKnowledgeEl) bonusKnowledgeEl.value = 0;
    if (bonusPacksEl) bonusPacksEl.value = 0;

    if (messageEl) {
        messageEl.textContent = "Quest created successfully.";
    }

    await renderTeacherQuestList();
}

async function renderTeacherQuestList() {
    const listEl = getEl("teacher-quest-list");
    if (!listEl || !currentTeacher) return;

    listEl.innerHTML = "";

    const { data: classRow, error: classError } = await supabaseClient
        .from("classes")
        .select("id")
        .eq("class_code", currentTeacher.classCode)
        .single();

    if (classError || !classRow) {
        listEl.innerHTML = "<p>Could not load class.</p>";
        return;
    }

    const { data: quests, error: questError } = await supabaseClient
        .from("quests")
        .select("*")
        .eq("class_id", classRow.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

    if (questError) {
        listEl.innerHTML = "<p>Could not load quests.</p>";
        return;
    }

    if (!quests || quests.length === 0) {
        listEl.innerHTML = "<p>No class quests yet.</p>";
        return;
    }

    quests.forEach(quest => {
        const row = document.createElement("div");
        row.style.marginBottom = "10px";
        row.style.padding = "10px";
        row.style.borderRadius = "8px";
        row.style.backgroundColor = "#3a3a55";

        row.innerHTML = `
            <strong>${quest.title}</strong><br>
            ${quest.instructions}<br>
            Main Reward: ${quest.reward_knowledge} Knowledge, ${quest.reward_packs} Pack(s)<br>
            Bonus Reward: ${quest.bonus_reward_knowledge || 0} Knowledge, ${quest.bonus_reward_packs || 0} Pack(s)
        `;

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete Quest";
        deleteBtn.style.marginTop = "8px";
        deleteBtn.onclick = () => deleteTeacherQuest(quest.id);

        row.appendChild(document.createElement("br"));
        row.appendChild(deleteBtn);

        listEl.appendChild(row);
    });
}

async function deleteTeacherQuest(questId) {
    if (!currentTeacher) return;

    const messageEl = getEl("teacher-quest-message");

    if (messageEl) {
        messageEl.textContent = "";
    }

    const { error } = await supabaseClient
        .from("quests")
        .update({ is_active: false })
        .eq("id", questId);

    if (error) {
        if (messageEl) {
            messageEl.textContent = "Could not delete quest.";
        }
        console.error("Soft delete quest error:", error);
        return;
    }

    if (messageEl) {
        messageEl.textContent = "Quest deleted successfully.";
    }

    await renderTeacherQuestList();
}


// =========================
// TEACHER SUBMISSIONS
// =========================
async function renderTeacherSubmissionList() {
    const list = getEl("teacher-submission-list");
    if (!list || !currentTeacher) return;

    list.innerHTML = "";

    const { data: classRow, error: classError } = await supabaseClient
        .from("classes")
        .select("id")
        .eq("class_code", currentTeacher.classCode)
        .single();

    if (classError || !classRow) {
        list.innerHTML = "<p>Could not load class.</p>";
        return;
    }

    const { data: submissions, error: submissionsError } = await supabaseClient
        .from("submissions")
        .select(`
            id,
            quest_id,
            student_id,
            submission_text,
            status,
            teacher_note,
            students!inner (
                id,
                student_name,
                class_id
            ),
            quests!inner (
                id,
                title,
                class_id
            )
        `)
        .eq("students.class_id", classRow.id)
        .in("status", ["Pending Review", "Needs Revision"])
        .order("submitted_at", { ascending: false });

    if (submissionsError) {
        console.error("Teacher submission load error:", submissionsError);
        list.innerHTML = "<p>Could not load submissions.</p>";
        return;
    }

    if (!submissions || submissions.length === 0) {
        list.innerHTML = "<p>No submissions waiting for review.</p>";
        return;
    }

    submissions.forEach(submission => {
        const studentName = submission.students.student_name;
        const questTitle = submission.quests.title;

        const btn = document.createElement("button");
        btn.style.display = "block";
        btn.style.width = "100%";
        btn.style.marginBottom = "8px";
        btn.textContent = `${studentName} - ${questTitle} (${submission.status})`;
        btn.onclick = () => {
            selectedTeacherSubmission = {
                submissionId: submission.id,
                studentName: studentName,
                questId: submission.quest_id
            };
            loadTeacherSelectedSubmission();
        };

        list.appendChild(btn);
    });
}

async function loadTeacherSelectedSubmission() {
    if (!currentTeacher || !selectedTeacherSubmission?.submissionId) return;

    const { data: submission, error } = await supabaseClient
        .from("submissions")
        .select(`
            id,
            quest_id,
            submission_text,
            status,
            teacher_note,
            students!inner (
                student_name
            ),
            quests!inner (
                title
            )
        `)
        .eq("id", selectedTeacherSubmission.submissionId)
        .single();

    if (error || !submission) {
        console.error("Load selected submission error:", error);
        return;
    }

    getEl("teacher-selected-student").textContent = submission.students.student_name;
    getEl("teacher-selected-quest").textContent = submission.quests.title;
    getEl("teacher-selected-status").textContent = submission.status;
    getEl("teacher-selected-text").value = submission.submission_text || "";
    getEl("teacher-note-box").value = submission.teacher_note || "";
    getEl("teacher-action-message").textContent = "";
}

function clearTeacherSelectedSubmission() {
    selectedTeacherSubmission = null;

    getEl("teacher-selected-student") && (getEl("teacher-selected-student").textContent = "--");
    getEl("teacher-selected-quest") && (getEl("teacher-selected-quest").textContent = "--");
    getEl("teacher-selected-status") && (getEl("teacher-selected-status").textContent = "--");

    const textEl = getEl("teacher-selected-text");
    if (textEl) textEl.value = "";

    const noteEl = getEl("teacher-note-box");
    if (noteEl) noteEl.value = "";

    const msgEl = getEl("teacher-action-message");
    if (msgEl) msgEl.textContent = "";
}

async function getTeacherVisibleQuests() {
    if (!currentTeacher) return [];

    const { data: classRow, error: classError } = await supabaseClient
        .from("classes")
        .select("id")
        .eq("class_code", currentTeacher.classCode)
        .single();

    if (classError || !classRow) return [];

    const { data: quests, error: questError } = await supabaseClient
        .from("quests")
        .select("*")
        .eq("class_id", classRow.id)
        .order("created_at", { ascending: false });

    if (questError || !quests) return [];

    return quests.map(quest => ({
        id: quest.id,
        title: quest.title
    }));
}

function writeTeacherReviewStatus(newStatus, successMessage) {
    if (!currentTeacher || !selectedTeacherSubmission) return;

    const studentName = selectedTeacherSubmission.studentName;
    const questId = selectedTeacherSubmission.questId;

    const key = getStudentStorageKey(currentTeacher.classCode, studentName);
    const studentData = JSON.parse(localStorage.getItem(key));
    if (!studentData || !studentData.questSubmissions?.[questId]) return;

    studentData.questSubmissions[questId].status = newStatus;
    studentData.questSubmissions[questId].teacherNote = getEl("teacher-note-box").value.trim();
    studentData.questSubmissions[questId].rewardClaimed = false;
    studentData.questSubmissions[questId].bonusClaimed = false;

    localStorage.setItem(key, JSON.stringify(studentData));

    getEl("teacher-action-message").textContent = successMessage;
    renderTeacherSubmissionList();
    clearTeacherSelectedSubmission();
}

async function approveSelectedSubmission() {
    if (!selectedTeacherSubmission?.submissionId) return;

    const actionMessageEl = getEl("teacher-action-message");
    const note = getEl("teacher-note-box").value.trim();

    if (actionMessageEl) {
        actionMessageEl.textContent = "";
    }

    const { error } = await supabaseClient
        .from("submissions")
        .update({
            status: "Approved - Reward Ready",
            teacher_note: note
        })
        .eq("id", selectedTeacherSubmission.submissionId);

    if (error) {
        console.error("Approve submission error:", error);
        if (actionMessageEl) {
            actionMessageEl.textContent = "Could not approve submission.";
        }
        return;
    }

    if (actionMessageEl) {
        actionMessageEl.textContent = "Submission approved.";
    }

    await renderTeacherSubmissionList();
    await loadTeacherSelectedSubmission();
}

async function approveSelectedSubmissionWithBonus() {
    if (!selectedTeacherSubmission?.submissionId) return;

    const actionMessageEl = getEl("teacher-action-message");
    const note = getEl("teacher-note-box").value.trim();

    if (actionMessageEl) {
        actionMessageEl.textContent = "";
    }

    const { error } = await supabaseClient
        .from("submissions")
        .update({
            status: "Approved with Bonus - Reward Ready",
            teacher_note: note
        })
        .eq("id", selectedTeacherSubmission.submissionId);

    if (error) {
        console.error("Approve with bonus error:", error);
        if (actionMessageEl) {
            actionMessageEl.textContent = "Could not approve submission.";
        }
        return;
    }

    if (actionMessageEl) {
        actionMessageEl.textContent = "Submission approved with bonus.";
    }

    await renderTeacherSubmissionList();
    await loadTeacherSelectedSubmission();
}

async function returnSelectedSubmissionForRevision() {
    if (!selectedTeacherSubmission?.submissionId) return;

    const actionMessageEl = getEl("teacher-action-message");
    const note = getEl("teacher-note-box").value.trim();

    if (actionMessageEl) {
        actionMessageEl.textContent = "";
    }

    const { error } = await supabaseClient
        .from("submissions")
        .update({
            status: "Needs Revision",
            teacher_note: note,
            reward_claimed: false,
            bonus_claimed: false
        })
        .eq("id", selectedTeacherSubmission.submissionId);

    if (error) {
        console.error("Return for revision error:", error);
        if (actionMessageEl) {
            actionMessageEl.textContent = "Could not return submission.";
        }
        return;
    }

    if (actionMessageEl) {
        actionMessageEl.textContent = "Submission returned for revision.";
    }

    await renderTeacherSubmissionList();
    await loadTeacherSelectedSubmission();
}


// =========================
// TEACHER ROSTER (SUPABASE)
// =========================
async function renderTeacherRoster() {
    const listEl = getEl("teacher-roster-list");
    const messageEl = getEl("teacher-roster-message");

    if (!listEl || !currentTeacher) return;

    listEl.innerHTML = "";
    if (messageEl) {
        messageEl.textContent = "";
    }

    const { data: classRow, error: classError } = await supabaseClient
        .from("classes")
        .select("id")
        .eq("class_code", currentTeacher.classCode)
        .single();

    if (classError || !classRow) {
        listEl.innerHTML = "<p>Could not load class.</p>";
        return;
    }

    const { data: students, error: studentsError } = await supabaseClient
        .from("students")
        .select("student_name")
        .eq("class_id", classRow.id)
        .order("student_name", { ascending: true });

    if (studentsError) {
        listEl.innerHTML = "<p>Could not load roster.</p>";
        return;
    }

    if (!students || students.length === 0) {
        listEl.innerHTML = "<p>No students in roster yet.</p>";
        return;
    }

    students.forEach(student => {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.marginBottom = "8px";
        row.style.gap = "8px";

        const nameSpan = document.createElement("span");
        nameSpan.textContent = student.student_name;

        const removeBtn = document.createElement("button");
        removeBtn.textContent = "Remove";
        removeBtn.onclick = () => removeStudentFromRoster(student.student_name);

        row.appendChild(nameSpan);
        row.appendChild(removeBtn);
        listEl.appendChild(row);
    });
}

async function addStudentToRoster() {
    if (!currentTeacher) return;

    const nameEl = getEl("new-student-name");
    const passwordEl = getEl("new-student-password");
    const messageEl = getEl("teacher-roster-message");

    const studentName = nameEl.value.trim().toUpperCase();
    const password = passwordEl.value.trim();

    if (messageEl) {
        messageEl.textContent = "";
    }

    if (!studentName || !password) {
        if (messageEl) {
            messageEl.textContent = "Enter both a student name and password.";
        }
        return;
    }

    const { data: classRow, error: classError } = await supabaseClient
        .from("classes")
        .select("id")
        .eq("class_code", currentTeacher.classCode)
        .single();

    if (classError || !classRow) {
        if (messageEl) {
            messageEl.textContent = "Could not find class.";
        }
        return;
    }

    const { data: existingStudent } = await supabaseClient
        .from("students")
        .select("id")
        .eq("class_id", classRow.id)
        .eq("student_name", studentName)
        .maybeSingle();

    if (existingStudent) {
        if (messageEl) {
            messageEl.textContent = "That student is already in the roster.";
        }
        return;
    }

    const { error: insertError } = await supabaseClient
        .from("students")
        .insert([
            {
                class_id: classRow.id,
                student_name: studentName,
                password_hash: password,
                knowledge: 0,
                basic_packs: 0
            }
        ]);

    if (insertError) {
        if (messageEl) {
            messageEl.textContent = "Could not add student.";
        }
        return;
    }

    nameEl.value = "";
    passwordEl.value = "";

    if (messageEl) {
        messageEl.textContent = "Student added successfully.";
    }

    await renderTeacherRoster();
    await renderTeacherSubmissionList();
}

async function removeStudentFromRoster(studentName) {
    if (!currentTeacher) return;

    const messageEl = getEl("teacher-roster-message");

    if (messageEl) {
        messageEl.textContent = "";
    }

    const { data: classRow, error: classError } = await supabaseClient
        .from("classes")
        .select("id")
        .eq("class_code", currentTeacher.classCode)
        .single();

    if (classError || !classRow) {
        if (messageEl) {
            messageEl.textContent = "Could not find class.";
        }
        return;
    }

    const { error: deleteError } = await supabaseClient
        .from("students")
        .delete()
        .eq("class_id", classRow.id)
        .eq("student_name", studentName);

    if (deleteError) {
        if (messageEl) {
            messageEl.textContent = "Could not remove student.";
        }
        return;
    }

    localStorage.removeItem(getStudentStorageKey(currentTeacher.classCode, studentName));

    if (messageEl) {
        messageEl.textContent = `${studentName} removed from roster.`;
    }

    await renderTeacherRoster();
    await renderTeacherSubmissionList();
}


// =========================
// HUB / PROFILE
// =========================
function updateHubUI() {
    if (!currentStudent) return;

    getEl("displayName").textContent = currentStudent.name;
    getEl("displayClass").textContent = currentStudent.classCode;
    getEl("knowledgeCount").textContent = currentStudent.knowledge;
    getEl("basicPackCount").textContent = currentStudent.packs.basic;
}


// =========================
// OPTIONAL STUBS
// =========================
function buyBasicPack() {
    if (!currentStudent) return;

    if (currentStudent.knowledge < BASIC_PACK_COST) {
        getEl("pack-message").textContent = "Not enough Knowledge!";
        return;
    }

    currentStudent.knowledge -= BASIC_PACK_COST;
    currentStudent.packs.basic += 1;

    updateHubUI();
    saveStudentData();

    getEl("pack-message").textContent = "Bought 1 Basic Pack!";
}
function openPack() {
    if (!currentStudent) return;

    if (currentStudent.packs.basic <= 0) {
        getEl("pack-message").textContent = "No packs available!";
        return;
    }

    currentStudent.packs.basic -= 1;
    updateHubUI();
    saveStudentData();

    showScreen("pack-screen");
}
function revealCards() {
    if (!currentStudent) return;

    const results = getEl("card-results");
    results.innerHTML = "";

    const pack = PACKS.basic;

    for (let i = 0; i < pack.cardsPerPack; i++) {
        const rarity = rollRarity(pack.odds);

        const possibleCards = CARDS.filter(c => c.rarity === rarity);
        const card = possibleCards[Math.floor(Math.random() * possibleCards.length)];

        if (!currentStudent.ownedCards.includes(card.id)) {
            currentStudent.ownedCards.push(card.id);
        }

        const div = document.createElement("div");
        div.textContent = `${card.name} (${card.rarity})`;
        results.appendChild(div);
    }

    saveStudentData();
}
function rollRarity(odds) {
    const roll = Math.random() * 100;
    let cumulative = 0;

    for (let rarity in odds) {
        cumulative += odds[rarity];
        if (roll <= cumulative) return rarity;
    }

    return "Common";
}
function openCollection() {}
function openProfile() {}
function addTestPack() {}
function addTestKnowledge() {}
function resetKnowledge() {}
function clearCollection() {}
function addSpecificTestCard() {}