package com.englishapp.service;

import com.englishapp.model.MeaningGroup;
import com.englishapp.model.Sentence;
import com.englishapp.model.UserAccount;
import com.englishapp.repository.MeaningGroupRepository;
import com.englishapp.repository.SentenceRepository;
import com.englishapp.repository.SentenceReviewRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class MeaningGroupService {

    private final MeaningGroupRepository meaningGroupRepository;
    private final SentenceRepository sentenceRepository;
    private final SentenceReviewRepository sentenceReviewRepository;
    private final ListSentenceService listSentenceService;

    public MeaningGroupService(
            MeaningGroupRepository meaningGroupRepository,
            SentenceRepository sentenceRepository,
            SentenceReviewRepository sentenceReviewRepository,
            ListSentenceService listSentenceService
    ) {
        this.meaningGroupRepository = meaningGroupRepository;
        this.sentenceRepository = sentenceRepository;
        this.sentenceReviewRepository = sentenceReviewRepository;
        this.listSentenceService = listSentenceService;
    }

    public List<Map<String, Object>> getMeaningGroups(Long userId) {
        return meaningGroupRepository.findAllByUserId(userId).stream()
                .map(group -> toPayload(group, sentenceRepository.countByMeaningGroup_Id(group.getId())))
                .toList();
    }

    public Map<String, Object> getMeaningGroup(Long groupId, Long userId) {
        MeaningGroup group = findGroupByUser(groupId, userId);
        return toPayload(group, sentenceRepository.countByMeaningGroup_Id(group.getId()));
    }

    @Transactional
    public Map<String, Object> createMeaningGroup(UserAccount user, String label, String notes) {
        MeaningGroup meaningGroup = new MeaningGroup();
        meaningGroup.setUser(user);
        meaningGroup.setLabel(normalizeOptionalText(label));
        meaningGroup.setNotes(normalizeOptionalText(notes));
        meaningGroup.setCreatedAt(Instant.now());
        meaningGroup = meaningGroupRepository.save(meaningGroup);
        return toPayload(meaningGroup, 0L);
    }

    @Transactional
    public Map<String, Object> updateMeaningGroup(Long groupId, Long userId, String label, String notes) {
        MeaningGroup meaningGroup = findGroupByUser(groupId, userId);
        meaningGroup.setLabel(normalizeOptionalText(label));
        meaningGroup.setNotes(normalizeOptionalText(notes));
        long sentenceCount = sentenceRepository.countByMeaningGroup_Id(groupId);
        return toPayload(meaningGroup, sentenceCount);
    }

    @Transactional
    public void deleteMeaningGroup(Long groupId, Long userId) {
        MeaningGroup meaningGroup = findGroupByUser(groupId, userId);
        meaningGroupRepository.delete(meaningGroup);
    }

    public List<Map<String, Object>> getSentencesInGroup(Long groupId, Long userId) {
        findGroupByUser(groupId, userId);
        Map<Long, Long> reviewCounts = sentenceReviewRepository.countReviewsBySentenceForUserAsMap(userId);
        return sentenceRepository.findByMeaningGroup_IdAndSentenceList_User_Id(groupId, userId).stream()
                .map(sentence -> listSentenceService.sentencePayload(
                        sentence,
                        reviewCounts.getOrDefault(sentence.getId(), 0L)
                ))
                .toList();
    }

    public List<Map<String, Object>> getSentenceVariants(Long sentenceId, Long userId) {
        Sentence sentence = listSentenceService.getSentenceByUser(sentenceId, userId);
        MeaningGroup group = sentence.getMeaningGroup();
        if (group == null) {
            return List.of();
        }
        Map<Long, Long> reviewCounts = sentenceReviewRepository.countReviewsBySentenceForUserAsMap(userId);
        return sentenceRepository.findByMeaningGroup_IdAndSentenceList_User_Id(group.getId(), userId).stream()
                .map(variant -> listSentenceService.sentencePayload(
                        variant,
                        reviewCounts.getOrDefault(variant.getId(), 0L)
                ))
                .toList();
    }

    @Transactional
    public Map<String, Object> assignSentenceToMeaningGroup(Long sentenceId, Long groupId, Long userId) {
        Sentence sentence = listSentenceService.getSentenceByUser(sentenceId, userId);
        MeaningGroup meaningGroup = findGroupByUser(groupId, userId);
        sentence.setMeaningGroup(meaningGroup);
        long reviewCount = sentenceReviewRepository.countBySentence_IdAndUser_Id(sentenceId, userId);
        return listSentenceService.sentencePayload(sentence, reviewCount);
    }

    @Transactional
    public Map<String, Object> unassignSentenceFromMeaningGroup(Long sentenceId, Long userId) {
        Sentence sentence = listSentenceService.getSentenceByUser(sentenceId, userId);
        sentence.setMeaningGroup(null);
        long reviewCount = sentenceReviewRepository.countBySentence_IdAndUser_Id(sentenceId, userId);
        return listSentenceService.sentencePayload(sentence, reviewCount);
    }

    private MeaningGroup findGroupByUser(Long groupId, Long userId) {
        return meaningGroupRepository.findByIdAndUser(groupId, userId)
                .orElseThrow(() -> new NotFoundException("Meaning group not found"));
    }

    private Map<String, Object> toPayload(MeaningGroup group, long sentenceCount) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("id", group.getId());
        payload.put("label", group.getLabel());
        payload.put("notes", group.getNotes());
        payload.put("createdAt", group.getCreatedAt());
        payload.put("sentenceCount", sentenceCount);
        return payload;
    }

    private static String normalizeOptionalText(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
