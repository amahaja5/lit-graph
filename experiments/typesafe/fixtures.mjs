// Synthetic, author-labeled diagnostic fixtures. Labels fixed before API calls.
// No user manuscripts or library data are sent. These are not a held-out benchmark.
export const retrieval = [
  { id: 'paraphrase', claim: 'The intervention reduced infant mortality in rural districts.', relevant: [
    'Among countryside newborns, deaths fell from 40 to 25 per thousand after the program was introduced.',
  ], distractors: [
    'Infant mortality in rural districts is a major policy concern. Whether the intervention reduced it is the question motivating this study.',
    'The intervention and infant mortality in rural districts appear in the study title. This section describes the organization of the report.',
    'Rural districts were selected to examine infant mortality. The intervention was announced in June; this paragraph records administrative dates.',
    'The infant mortality intervention in rural districts was funded by two agencies. We acknowledge their financial contributions.',
    'A review of intervention studies on infant mortality in rural districts is planned for next year.',
    'Survey teams recorded the names of rural districts. Infant mortality and intervention status were column headings in the database.',
    'The intervention targeted infant mortality in rural districts. No outcome measurements are presented in this introduction.',
    'Permissions for the intervention study of infant mortality in rural districts were obtained in advance.',
    'The questionnaire asked whether participants had heard the terms infant mortality and intervention in rural districts.',
  ] },
  { id: 'negation', claim: 'Adding the adapter improves accuracy on unseen domains.', relevant: [
    'On held-out distributions, the augmented network scored 71%, compared with 79% for the unmodified baseline. The added module therefore degraded generalization.',
  ], distractors: [
    'Adding the adapter improves accuracy on unseen domains is our hypothesis, to be tested in the next section.',
    'Accuracy on unseen domains is the outcome used to evaluate adding the adapter. This section defines the metric without reporting results.',
    'Our literature search used the keywords adapter, accuracy, improves, and unseen domains.',
    'The adapter was implemented in Python. Unseen domains and accuracy measurements were saved to disk.',
    'The appendix contains configuration names for adding the adapter and testing accuracy on unseen domains.',
    'We thank the organizers of the workshop on accuracy and adapters for unseen domains.',
    'A preregistration asked whether adding the adapter improves accuracy on unseen domains; data collection had not begun.',
    'The words adding, adapter, improves, accuracy, and unseen domains occur in the search query used for screening titles.',
    'Unseen domains were assigned numeric labels before adding the adapter. Accuracy is discussed later.',
  ] },
  { id: 'numerical_direct', claim: 'Model A achieved 95.3 percent validity.', relevant: [
    'Model A achieved 95.3 percent validity on the evaluation set.',
  ], distractors: ['The evaluation set contains molecular strings.', 'The training schedule lasted ten epochs.', 'We used a batch size of 32.', 'The authors released source code.', 'A validation split was reserved.', 'All trials ran on one GPU.', 'The vocabulary contains 70 tokens.', 'The data were shuffled.', 'We report hardware specifications.'] },
  { id: 'contradiction_direct', claim: 'The treatment increased mean income by 20 percent.', relevant: [
    'The treatment did not increase mean income by 20 percent: mean income fell by 5 percent compared with controls.',
  ], distractors: ['Income was measured annually.', 'Respondents consented to participate.', 'Treatment assignment was randomized.', 'The survey had ten questions.', 'Control households received no payment.', 'Currency amounts were inflation adjusted.', 'The field team used tablets.', 'Attrition is tabulated separately.', 'Data were anonymized before release.'] },
  { id: 'scope', claim: 'The classifier works equally well in every language.', relevant: [
    'English test accuracy reached 92%; Spanish reached 61%. No other languages were evaluated.',
  ], distractors: ['The classifier is intended for use in every language.', 'We discuss what works equally well means for a classifier in every language.', 'Every language has its own classifier vocabulary.', 'The classifier interface lets users select a language.', 'Work on the classifier began in January.', 'Language identifiers were saved as strings.', 'Every classifier checkpoint is downloadable.', 'The classifier was trained using a GPU.', 'We acknowledge the language annotation team.'] },
  { id: 'two_sided', claim: 'The reform raised employment across all age groups.', relevant: [
    'For workers aged 25–54, the policy increased the fraction holding a job by four percentage points.',
    'Among people younger than 25 and older than 54, the policy reduced the fraction holding a job by two percentage points.',
  ], distractors: ['Employment across all age groups is the focus of the reform proposal.', 'The reform employment questionnaire listed all age groups.', 'The reform raised questions about employment across all age groups.', 'The employment reform across all age groups was debated in parliament.', 'Employment reform and age groups are the keywords of this report.', 'The reform timetable applies across all age groups; employment results follow later.', 'We explain how employment and age groups were recorded for the reform.', 'The reform employment dataset covers all age groups.', 'The employment reform across all age groups received research funding.'] },
  { id: 'method_direct', claim: 'The study used random assignment at the school level.', relevant: [
    'The study used random assignment at the school level: a computer assigned 40 schools to treatment and 40 to control.',
  ], distractors: ['Pupil attendance was measured daily.', 'Parents received information sheets.', 'The study protocol was approved.', 'Teachers completed surveys.', 'The study ran for two years.', 'Outcomes included examination scores.', 'The data include urban and rural areas.', 'Baseline ages ranged from 10 to 12.', 'We thank the participating teachers.'] },
  { id: 'limitation_direct', claim: 'The analysis proves that screen time causes depression.', relevant: [
    'This observational analysis of screen time and depression cannot establish causation; unmeasured confounding may explain the association.',
  ], distractors: ['Participants completed an online survey.', 'Screen time was self-reported.', 'Depression was measured with a questionnaire.', 'Missing values were described.', 'The analysis software was version 4.', 'The sample contained 800 people.', 'The authors declare no conflicts.', 'Survey invitations were sent by email.', 'Supplementary tables contain descriptive statistics.'] },
];

export const html = [
  ['research', true, 'Our randomized trial assigned 240 schools to receive tutoring or usual instruction. After one year, treated pupils scored 0.18 standard deviations higher on the mathematics examination, with a 95% confidence interval of 0.08 to 0.28.'],
  ['abstract', true, 'Abstract. We introduce a sparse attention mechanism that reduces memory use. Experiments on three language modeling corpora show comparable perplexity to dense attention while using 40 percent less memory at long sequence lengths.'],
  ['negative_result', true, 'Results. The treatment did not improve survival. The estimated hazard ratio was 1.02 with a 95 percent confidence interval from 0.88 to 1.19. Adverse events were similar in the two groups, and follow-up continued for twelve months.'],
  ['methods', true, 'Methods. We sampled 80 villages using stratified random sampling. Within each village, enumerators visited 25 households. Sampling weights correct for unequal selection probabilities, and standard errors are clustered at the village level.'],
  ['limitations', true, 'Limitations. Because this study is observational, the reported association should not be interpreted as causal. Self-reported outcomes may contain measurement error. Our sample includes only urban adults, limiting applicability to rural populations.'],
  ['mixed_cookie_research', true, 'This site uses cookies. Results: our experiment randomly assigned 600 participants to two conditions. Recall was 15 percentage points higher with spaced practice than massed practice. The preregistered analysis adjusts for baseline memory scores.'],
  ['cookie', false, 'We use cookies and similar technologies to personalize your experience, analyze traffic, and improve our services. Select accept all to consent to optional cookies, or manage preferences to choose your settings. You can change your choices at any time.'],
  ['paywall', false, 'Access to this article requires a subscription. Sign in through your institution or purchase individual access. Contact your librarian for assistance with access rights. This page provides account management and payment options but does not display the article.'],
  ['captcha', false, 'Checking your browser before continuing. Please verify that you are a human by completing the security challenge. Enable JavaScript and cookies to proceed. Your connection is being reviewed for unusual activity. This process may take a few seconds.'],
  ['navigation', false, 'Browse journals by subject, author, publication year, or publisher. Visit our help center for frequently asked questions. Explore trending articles, sign up for email alerts, manage your account preferences, and discover new collections on our platform.'],
  ['metadata', false, 'Title: Sparse Attention for Long Documents. Authors: Ada Smith and Ben Lee. Publication year: 2025. Journal: Computational Methods. Volume 12, issue 3, pages 100–120. DOI: 10.1234/example. Download citation, share this article, or request permissions.'],
  ['references', false, 'References. Smith, A. (2021). Randomized Trials in Education. Research Press. Lee, B. (2022). Understanding Student Achievement. Journal of Education, 10, 20–40. Garcia, C. (2023). Tutoring in Schools. Learning Science, 8, 50–75. Export all references.'],
  ['unrelated_article', false, 'Weekend Gardening Guide. Plant tomatoes in a sunny location after the last frost. Water consistently and add compost to improve soil texture. Mulch helps retain moisture and suppress weeds. Harvest the fruit when fully colored and slightly soft to the touch.'],
  ['empty', false, ''],
  ['short_result', true, 'Results: treatment reduced errors by 23% versus control (95% CI 12–34%).'],
  ['quoted_claim_on_paywall', false, 'Article title: Tutoring improves examination performance. To read the abstract and results, please subscribe or log in through your institution. Access is restricted to registered subscribers. We offer monthly and annual plans with automatic renewal.'],
].map(([id, useful, text]) => ({id, useful, text, title: id === 'unrelated_article' ? 'Sparse Attention for Long Documents' : undefined}));

export const relations = [
  ['exact', 'Model A achieved 95.3 percent validity.', 'Model A achieved 95.3 percent validity.', 'supported'],
  ['paraphrase', 'The program reduced newborn deaths.', 'After implementation, neonatal fatalities fell by 30 percent relative to controls.', 'supported'],
  ['null', 'The intervention significantly improved scores.', 'The estimated effect on scores was 0.01 SD (p = 0.87); there was no statistically significant improvement.', 'contradicted'],
  ['different_number', 'Accuracy reached 95 percent.', 'Accuracy reached 75 percent on the evaluation set.', 'contradicted'],
  ['subset', 'The model performs well on English and German.', 'English accuracy was 95 percent. German was not evaluated.', 'partially_supported'],
  ['unrelated', 'The treatment reduced mortality.', 'The questionnaire contained twelve items and was administered by telephone.', 'insufficient_evidence'],
  ['hypothesis', 'The adapter improved generalization.', 'We hypothesize that the adapter will improve generalization. Experiments have not yet been run.', 'insufficient_evidence'],
  ['causal', 'Screen time causes depression.', 'Screen time correlated with depression. The observational design cannot establish causality.', 'partially_supported'],
  ['wrong_population', 'The therapy improves memory in children.', 'In adults aged 65 to 80, the therapy improved memory. No children participated.', 'insufficient_evidence'],
  ['relative_absolute', 'The event rate dropped by 20 percentage points.', 'The event rate fell from 10 percent to 8 percent, a relative reduction of 20 percent.', 'contradicted'],
  ['qualified', 'The algorithm reduced runtime on the tested graphs.', 'On all twelve tested graphs, the algorithm ran faster than the baseline.', 'supported'],
  ['missing_outcome', 'The policy increased wages.', 'The policy increased employment by four percentage points. Wages were not measured.', 'insufficient_evidence'],
  ['two_claims', 'The method improves accuracy and halves runtime.', 'Accuracy improved from 80 to 90 percent. Runtime was not recorded.', 'partially_supported'],
  ['negated_quote', 'The authors found that the program eliminated poverty.', 'It would be incorrect to conclude that the program eliminated poverty; poverty rates were unchanged.', 'contradicted'],
  ['attribution', 'This study experimentally demonstrates the benefit.', 'Prior work speculates that the method might help. Our study contains no experiments testing that conjecture.', 'contradicted'],
  ['rounded', 'Roughly half of participants completed follow-up.', 'Follow-up was completed by 49.8 percent of enrolled participants.', 'supported'],
].map(([id, claim, excerpt, expected]) => ({id, claim, excerpt, expected}));
