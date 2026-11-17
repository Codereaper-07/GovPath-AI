// Hindi explanations of the document types (GovPath's own descriptions, not official text).
// Keyed by document id. `en` is the exact English description each translation was made from
// (data/knowledge/documents.json): the Hindi is shown only while the API still returns that
// same English, so an edited English description falls back to English instead of a stale
// translation. Official evidence quotes are never translated.
export const DOCUMENT_DESCRIPTIONS_HI: Readonly<Record<string, { en: string; hi: string }>> = {
  aadhaar_number: {
    en: "The Aadhaar number of the person whose Aadhaar is being updated.",
    hi: "उस व्यक्ति का आधार नंबर, जिसके आधार में बदलाव किया जा रहा है।",
  },
  mobile_linked_to_aadhaar: {
    en: "Needed to receive the OTP for online Aadhaar update.",
    hi: "ऑनलाइन आधार अपडेट के लिए ओटीपी (OTP) पाने हेतु ज़रूरी।",
  },
  epic_existing: {
    en: "EPIC number of an elector already enrolled in the electoral roll.",
    hi: "मतदाता सूची में पहले से दर्ज मतदाता का EPIC नंबर।",
  },
  driving_licence_existing: {
    en: "Your current driving licence (the one being updated, renewed or replaced).",
    hi: "आपका मौजूदा ड्राइविंग लाइसेंस (जिसे अपडेट, नवीनीकृत या बदला जा रहा है)।",
  },
  rc_existing: {
    en: "The vehicle's current registration certificate.",
    hi: "वाहन का मौजूदा पंजीकरण प्रमाणपत्र (आरसी)।",
  },
  passport_existing: {
    en: "The currently held passport, submitted in original with self-attested copies of its first two and last two pages.",
    hi: "आपके पास मौजूद पासपोर्ट, जो मूल रूप में जमा होता है, साथ में इसके पहले दो और आख़िरी दो पन्नों की स्व-सत्यापित प्रतियाँ।",
  },
  aadhaar_current_address: {
    en: "Aadhaar letter, card or e-Aadhaar that already shows the new address.",
    hi: "आधार पत्र, कार्ड या ई-आधार, जिसमें नया पता पहले से दर्ज हो।",
  },
  voter_id_current_address: {
    en: "Voter ID card / e-EPIC issued for the new address.",
    hi: "नए पते के लिए जारी मतदाता पहचान पत्र / ई-EPIC।",
  },
  electoral_roll_entry_current_address: {
    en: "Your entry in the electoral roll at the new address.",
    hi: "नए पते पर मतदाता सूची में आपकी प्रविष्टि।",
  },
  passport_current_address: {
    en: "A valid Indian passport whose address is the new address.",
    hi: "वैध भारतीय पासपोर्ट, जिसमें नया पता दर्ज हो।",
  },
  driving_licence_current_address: {
    en: "Driving licence with the new address printed on it.",
    hi: "ड्राइविंग लाइसेंस, जिस पर नया पता छपा हो।",
  },
  rc_current_address: {
    en: "Certificate of registration with the new address recorded.",
    hi: "पंजीकरण प्रमाणपत्र (आरसी), जिसमें नया पता दर्ज हो।",
  },
  electricity_bill: {
    en: "Electricity bill for the new address. Age limits differ by service (see requirement notes).",
    hi: "नए पते का बिजली बिल। बिल कितना पुराना हो सकता है, यह हर सेवा में अलग है (आवश्यकता के नोट देखें)।",
  },
  water_bill: {
    en: "Water bill for the new address. Age limits differ by service.",
    hi: "नए पते का पानी का बिल। बिल कितना पुराना हो सकता है, यह हर सेवा में अलग है।",
  },
  gas_bill: {
    en: "Gas bill for the new address. Age limits differ by service.",
    hi: "नए पते का गैस बिल। बिल कितना पुराना हो सकता है, यह हर सेवा में अलग है।",
  },
  telephone_bill: {
    en: "Phone or broadband bill for the new address.",
    hi: "नए पते का फ़ोन या ब्रॉडबैंड बिल।",
  },
  bank_or_post_office_passbook: {
    en: "Passbook showing the new address. Each service has its own conditions (photo, bank type, stamp).",
    hi: "नया पता दिखाने वाली पासबुक। हर सेवा की अपनी शर्तें हैं (फ़ोटो, बैंक का प्रकार, मुहर)।",
  },
  bank_statement: {
    en: "Statement with bank stamp and signature, showing the new address.",
    hi: "बैंक की मुहर और हस्ताक्षर वाला खाता विवरण, जिसमें नया पता हो।",
  },
  ration_card: {
    en: "Ration card showing the new address.",
    hi: "नया पता दिखाने वाला राशन कार्ड।",
  },
  property_tax_receipt: {
    en: "Property tax receipt for the new address.",
    hi: "नए पते की संपत्ति कर रसीद।",
  },
  rent_or_lease_agreement: {
    en: "Rent, lease or leave-and-licence agreement for the new address. Some services require it to be registered.",
    hi: "नए पते का किराया, लीज़ या लीव-एंड-लाइसेंस अनुबंध। कुछ सेवाओं में इसका पंजीकृत होना ज़रूरी है।",
  },
  registered_sale_deed: {
    en: "Sale deed or sale agreement registered with the Registrar for the new address.",
    hi: "नए पते का विक्रय विलेख या विक्रय अनुबंध, जो रजिस्ट्रार के यहाँ पंजीकृत हो।",
  },
  land_records: {
    en: "Land records from the Revenue Department.",
    hi: "राजस्व विभाग के भू-अभिलेख।",
  },
  life_insurance_policy: {
    en: "Insurance policy document showing the new address.",
    hi: "नया पता दिखाने वाला बीमा पॉलिसी दस्तावेज़।",
  },
  uidai_address_certificate: {
    en: "Certificate on the UIDAI standard format issued by an authorised signatory (e.g. MP/MLA, gazetted officer, Tehsildar, village panchayat head).",
    hi: "UIDAI के मानक प्रारूप में किसी अधिकृत हस्ताक्षरकर्ता (जैसे सांसद/विधायक, राजपत्रित अधिकारी, तहसीलदार, ग्राम पंचायत प्रमुख) द्वारा जारी प्रमाणपत्र।",
  },
  income_tax_assessment_order: {
    en: "Income Tax assessment order showing the new address.",
    hi: "नया पता दिखाने वाला आयकर निर्धारण आदेश।",
  },
  employer_certificate: {
    en: "Address certificate on company letterhead with seal (public limited companies only, per Passport Seva).",
    hi: "कंपनी के लेटरहेड पर मुहर सहित पते का प्रमाणपत्र (पासपोर्ट सेवा के अनुसार केवल पब्लिक लिमिटेड कंपनियों के लिए)।",
  },
  spouse_passport: {
    en: "Spouse's passport naming the applicant as spouse, where the address matches the applicant's present address.",
    hi: "पति/पत्नी का पासपोर्ट, जिसमें आवेदक का नाम पति/पत्नी के रूप में दर्ज हो, जब उसमें दिया पता आवेदक के वर्तमान पते से मेल खाता हो।",
  },
  rto_accepted_address_proof: {
    en: "Parivahan does not list specific documents for RC address change; use a proof of address accepted by your State Transport Department / RTO.",
    hi: "परिवहन (Parivahan) आरसी में पता बदलने के लिए कोई विशेष दस्तावेज़ नहीं बताता; अपने राज्य परिवहन विभाग / आरटीओ द्वारा मान्य पते का प्रमाण दें।",
  },
  vehicle_insurance_certificate: {
    en: "Current motor insurance certificate for the vehicle.",
    hi: "वाहन का वर्तमान मोटर बीमा प्रमाणपत्र।",
  },
  puc_certificate: {
    en: "Valid PUC certificate for the vehicle.",
    hi: "वाहन का वैध पीयूसी (PUC) प्रमाणपत्र।",
  },
  financier_noc: {
    en: "NOC from the bank/financier when the vehicle is hypothecated.",
    hi: "वाहन गिरवी (हाइपोथिकेशन) पर होने पर बैंक/फ़ाइनेंसर से अनापत्ति प्रमाणपत्र (NOC)।",
  },
  pan_or_form_60_61: {
    en: "Attested copy of PAN card, or Form 60/61 as applicable.",
    hi: "पैन कार्ड की सत्यापित प्रति, या लागू होने पर फ़ॉर्म 60/61।",
  },
  chassis_engine_pencil_print: {
    en: "Pencil impression of the vehicle's chassis and engine numbers.",
    hi: "वाहन के चेसिस और इंजन नंबर की पेंसिल से ली गई छाप।",
  },
  photograph: {
    en: "Recent passport-size photograph.",
    hi: "हाल का पासपोर्ट आकार का फ़ोटो।",
  },
  marriage_certificate: {
    en: "Marriage registration certificate issued by a Central/State Government authority.",
    hi: "केंद्र/राज्य सरकार के प्राधिकरण द्वारा जारी विवाह पंजीकरण प्रमाणपत्र।",
  },
  gazette_notification_name_change: {
    en: "Official Gazette notification publishing a change of name.",
    hi: "नाम परिवर्तन प्रकाशित करने वाली आधिकारिक राजपत्र (गजट) अधिसूचना।",
  },
  joint_photo_declaration: {
    en: "Declaration signed by both spouses with a joint photograph, in the Passport Seva Annexure J format.",
    hi: "पति-पत्नी दोनों द्वारा हस्ताक्षरित, संयुक्त फ़ोटो सहित घोषणा, पासपोर्ट सेवा के अनुलग्नक J (Annexure J) प्रारूप में।",
  },
  aadhaar_updated_name: {
    en: "Aadhaar letter/card/e-Aadhaar after a name update.",
    hi: "नाम अपडेट होने के बाद का आधार पत्र/कार्ड/ई-आधार।",
  },
  passport_updated_name: {
    en: "Passport reissued with the changed name/surname.",
    hi: "बदले हुए नाम/उपनाम के साथ दोबारा जारी पासपोर्ट।",
  },
  pan_card: {
    en: "Permanent Account Number allotted by the Income Tax Department.",
    hi: "आयकर विभाग द्वारा आवंटित स्थायी खाता संख्या (PAN)।",
  },
  birth_certificate: {
    en: "Birth certificate issued under the Registration of Births and Deaths Act, 1969.",
    hi: "जन्म और मृत्यु पंजीकरण अधिनियम, 1969 के तहत जारी जन्म प्रमाणपत्र।",
  },
  matriculation_certificate: {
    en: "Matriculation certificate showing date of birth.",
    hi: "जन्म तिथि दिखाने वाला मैट्रिकुलेशन प्रमाणपत्र।",
  },
  matriculation_marksheet: {
    en: "Matriculation marksheet issued by a recognised board.",
    hi: "मान्यता प्राप्त बोर्ड द्वारा जारी मैट्रिकुलेशन अंकपत्र।",
  },
  cghs_card: {
    en: "Central Government Health Scheme card.",
    hi: "केंद्र सरकार स्वास्थ्य योजना (CGHS) कार्ड।",
  },
  digilocker_access: {
    en: "Access to the DigiLocker platform (used to fetch proof of date of birth).",
    hi: "डिजिलॉकर (DigiLocker) प्लेटफ़ॉर्म तक पहुँच (जन्म तिथि का प्रमाण प्राप्त करने के लिए)।",
  },
  marriage_affidavits: {
    en: "Affidavits stating date and place of marriage, date of birth, marital status, non-prohibited relationship and citizenship.",
    hi: "शपथपत्र, जिनमें विवाह की तिथि और स्थान, जन्म तिथि, वैवाहिक स्थिति, निषिद्ध संबंध न होना और नागरिकता बताई गई हो।",
  },
  marriage_photographs_attested: {
    en: "Passport-size photographs (2 each) and ceremonial photographs, attested as specified.",
    hi: "पासपोर्ट आकार के फ़ोटो (हर पक्ष के 2) और विवाह समारोह के फ़ोटो, बताए गए तरीके से सत्यापित।",
  },
  marriage_invitation_card: {
    en: "Self-attested wedding invitation card.",
    hi: "स्व-सत्यापित विवाह निमंत्रण पत्र।",
  },
  divorce_decree_or_spouse_death_certificate: {
    en: "Attested copy, for divorced or widowed applicants.",
    hi: "सत्यापित प्रति, तलाक़शुदा या विधवा/विधुर आवेदकों के लिए।",
  },
  priest_certificate: {
    en: "Certificate from the priest who solemnised the marriage at a religious place.",
    hi: "धार्मिक स्थल पर विवाह संपन्न कराने वाले पुजारी का प्रमाणपत्र।",
  },
  embassy_marital_status_certificate: {
    en: "For a foreign national party.",
    hi: "विदेशी नागरिक पक्ष के लिए।",
  },
  parent_aadhaar_numbers: {
    en: "Aadhaar numbers of both parents, or of the single parent/legal guardian the child lives with.",
    hi: "माता-पिता दोनों के आधार नंबर, या उस एकल माता/पिता/कानूनी अभिभावक का, जिसके साथ बच्चा रहता है।",
  },
  legal_guardianship_document: {
    en: "Issued by a Central/State Government authority or a court under the relevant Acts.",
    hi: "संबंधित अधिनियमों के तहत केंद्र/राज्य सरकार के प्राधिकरण या न्यायालय द्वारा जारी।",
  },
  child_aadhaar: {
    en: "Aadhaar issued after enrolment of a child.",
    hi: "बच्चे का नामांकन होने के बाद जारी आधार।",
  },
  passport_fresh: {
    en: "A passport issued to someone who has never held one.",
    hi: "ऐसे व्यक्ति को जारी पासपोर्ट, जिसके पास पहले कभी पासपोर्ट नहीं रहा।",
  },
  driving_licence_renewed: {
    en: "The driving licence after renewal by the Licensing Authority.",
    hi: "लाइसेंसिंग प्राधिकरण द्वारा नवीनीकरण के बाद का ड्राइविंग लाइसेंस।",
  },
  driving_licence_duplicate: {
    en: "A duplicate licence issued when the original is lost, destroyed, defaced or needs a new photograph.",
    hi: "मूल लाइसेंस खो जाने, नष्ट होने, ख़राब होने या नए फ़ोटो की ज़रूरत होने पर जारी डुप्लिकेट लाइसेंस।",
  },
  driving_licence_attested_copy: {
    en: "An attested photocopy of the licence, if you have one.",
    hi: "लाइसेंस की सत्यापित फ़ोटोकॉपी, अगर आपके पास हो।",
  },
  fitness_self_declaration_form1: {
    en: "Form 1 under the Central Motor Vehicles Rules, for non-transport vehicles.",
    hi: "केंद्रीय मोटर वाहन नियमों (Central Motor Vehicles Rules) के तहत फ़ॉर्म 1, गैर-परिवहन वाहनों के लिए।",
  },
  medical_certificate_form1a: {
    en: "Form 1A medical certificate, for transport vehicles only.",
    hi: "फ़ॉर्म 1A चिकित्सा प्रमाणपत्र, केवल परिवहन वाहनों के लिए।",
  },
  police_report_lost_document: {
    en: "Certificate or report from the police station where the loss or theft occurred.",
    hi: "उस पुलिस थाने का प्रमाणपत्र या रिपोर्ट, जहाँ चोरी हुई या दस्तावेज़ खोया।",
  },
  affidavit_rc_lost: {
    en: "Affidavit stating that the registration certificate is lost and has not been impounded.",
    hi: "शपथपत्र, जिसमें बताया गया हो कि पंजीकरण प्रमाणपत्र (आरसी) खो गया है और ज़ब्त नहीं किया गया है।",
  },
  rc_duplicate: {
    en: "Duplicate RC issued to the registered owner when the original is lost, mutilated, torn or used up.",
    hi: "मूल आरसी खो जाने, क्षतिग्रस्त होने, फट जाने या पूरी तरह भर जाने पर पंजीकृत मालिक को जारी डुप्लिकेट आरसी।",
  },
  voter_id_new_registration: {
    en: "The EPIC delivered after enrolment through Form 6.",
    hi: "फ़ॉर्म 6 से नामांकन के बाद मिलने वाला मतदाता पहचान पत्र (EPIC)।",
  },
}
