package com.englishapp.service;

import com.englishapp.model.Sentence;
import com.englishapp.model.SentenceList;
import com.englishapp.model.UserAccount;
import com.englishapp.repository.SentenceListRepository;
import com.englishapp.repository.SentenceRepository;
import com.englishapp.repository.SentenceReviewRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class ListSentenceService {
    private final SentenceListRepository sentenceListRepository;
    private final SentenceRepository sentenceRepository;
    private final SentenceReviewRepository sentenceReviewRepository;
    private final ScheduleService scheduleService;

    public ListSentenceService(
            SentenceListRepository sentenceListRepository,
            SentenceRepository sentenceRepository,
            SentenceReviewRepository sentenceReviewRepository,
            ScheduleService scheduleService
    ) {
        this.sentenceListRepository = sentenceListRepository;
        this.sentenceRepository = sentenceRepository;
        this.sentenceReviewRepository = sentenceReviewRepository;
        this.scheduleService = scheduleService;
    }

    public List<Map<String, Object>> getLists(Long userId) {
        return sentenceListRepository.findByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(list -> {
                    long sentenceCount = sentenceRepository.countBySentenceList_IdAndSentenceList_User_Id(list.getId(), userId);
                    return Map.<String, Object>of(
                            "id", list.getId(),
                            "name", list.getName(),
                            "createdAt", list.getCreatedAt(),
                            "sentenceCount", sentenceCount
                    );
                })
                .toList();
    }

    @Transactional
    public Map<String, Object> createList(UserAccount user, String name) {
        SentenceList list = new SentenceList();
        list.setUser(user);
        list.setName(name);
        list.setCreatedAt(Instant.now());
        list = sentenceListRepository.save(list);
        return Map.<String, Object>of("id", list.getId(), "name", list.getName(), "createdAt", list.getCreatedAt());
    }

    @Transactional
    public Map<String, Object> renameList(Long userId, Long listId, String newName) {
        SentenceList list = getListByUser(listId, userId);
        list.setName(newName);
        return Map.<String, Object>of("id", list.getId(), "name", list.getName(), "createdAt", list.getCreatedAt());
    }

    @Transactional
    public void deleteList(Long userId, Long listId) {
        SentenceList list = getListByUser(listId, userId);
        sentenceListRepository.delete(list);
    }

    public List<Map<String, Object>> getSentences(Long userId, Long listId) {
        getListByUser(listId, userId);
        Map<Long, Long> reviewCounts = sentenceReviewRepository.countReviewsBySentenceForUserAsMap(userId);
        return sentenceRepository.findByListAndUser(listId, userId).stream()
                .map(s -> sentencePayload(s, reviewCounts.getOrDefault(s.getId(), 0L)))
                .toList();
    }

    public Map<String, Object> getSentencesPaginated(Long userId, Long listId, int page, int size) {
        getListByUser(listId, userId);
        int safeSize = Math.min(Math.max(1, size), 100);
        Pageable pageable = PageRequest.of(page, safeSize);
        var sentencePage = sentenceRepository.findByListAndUser(listId, userId, pageable);
        Map<Long, Long> reviewCounts = sentenceReviewRepository.countReviewsBySentenceForUserAsMap(userId);
        List<Map<String, Object>> content = sentencePage.getContent().stream()
                .map(s -> sentencePayload(s, reviewCounts.getOrDefault(s.getId(), 0L)))
                .toList();
        boolean hasMore = sentencePage.getNumber() < sentencePage.getTotalPages() - 1;
        return Map.<String, Object>of("content", content, "hasMore", hasMore);
    }

    public List<Map<String, Object>> searchSentences(Long userId, String query) {
        if (query == null || query.trim().isEmpty()) {
            return List.of();
        }
        String q = query.trim();
        Map<Long, Long> reviewCounts = sentenceReviewRepository.countReviewsBySentenceForUserAsMap(userId);
        return sentenceRepository.findByUserAndContentContainingIgnoreCase(userId, q).stream()
                .map(s -> sentencePayloadWithListName(s, reviewCounts.getOrDefault(s.getId(), 0L)))
                .toList();
    }

    public List<Map<String, Object>> findExistingInLists(Long userId, String content) {
        if (content == null || content.trim().isEmpty()) {
            return List.of();
        }
        return sentenceRepository.findByUserAndContentNormalized(userId, content).stream()
                .collect(Collectors.toMap(
                        s -> s.getSentenceList().getId(),
                        s -> Map.<String, Object>of(
                                "listId", s.getSentenceList().getId(),
                                "listName", s.getSentenceList().getName()
                        ),
                        (a, b) -> a
                ))
                .values().stream().toList();
    }

    @Transactional
    public Map<String, Object> addSentence(Long userId, Long listId, String content) {
        SentenceList list = getListByUser(listId, userId);
        List<Map<String, Object>> existing = findExistingInLists(userId, content);
        if (!existing.isEmpty()) {
            List<String> names = existing.stream()
                    .map(m -> (String) m.get("listName"))
                    .collect(Collectors.toList());
            throw new DuplicateSentenceException(
                    "Sentence already exists in: " + String.join(", ", names),
                    names
            );
        }
        Sentence sentence = new Sentence();
        sentence.setSentenceList(list);
        sentence.setContent(content);
        sentence.setCreatedAt(Instant.now());
        sentence = sentenceRepository.save(sentence);
        scheduleService.createDefaultSchedule(sentence);
        return sentencePayload(sentence, 0L);
    }

    @Transactional
    public Map<String, Object> editSentence(Long userId, Long sentenceId, String content) {
        Sentence sentence = getSentenceByUser(sentenceId, userId);
        sentence.setContent(content);
        long reviewCount = sentenceReviewRepository.countBySentence_IdAndUser_Id(sentenceId, userId);
        return sentencePayload(sentence, reviewCount);
    }

    @Transactional
    public void deleteSentence(Long userId, Long sentenceId) {
        Sentence sentence = getSentenceByUser(sentenceId, userId);
        sentenceRepository.delete(sentence);
    }

    @Transactional
    public Map<String, Object> moveSentence(Long userId, Long sentenceId, Long targetListId) {
        Sentence sentence = getSentenceByUser(sentenceId, userId);
        SentenceList target = getListByUser(targetListId, userId);
        sentence.setSentenceList(target);
        long reviewCount = sentenceReviewRepository.countBySentence_IdAndUser_Id(sentenceId, userId);
        return sentencePayload(sentence, reviewCount);
    }

    public Sentence getSentenceByUser(Long sentenceId, Long userId) {
        return sentenceRepository.findByIdAndUser(sentenceId, userId)
                .orElseThrow(() -> new NotFoundException("Sentence not found"));
    }

    private SentenceList getListByUser(Long listId, Long userId) {
        return sentenceListRepository.findByIdAndUserId(listId, userId)
                .orElseThrow(() -> new NotFoundException("List not found"));
    }

    public Map<String, Object> sentencePayload(Sentence sentence, long reviewCount) {
        return Map.<String, Object>of(
                "id", sentence.getId(),
                "listId", sentence.getSentenceList().getId(),
                "content", sentence.getContent(),
                "createdAt", sentence.getCreatedAt(),
                "reviewCount", reviewCount
        );
    }

    private Map<String, Object> sentencePayloadWithListName(Sentence sentence, long reviewCount) {
        return Map.<String, Object>of(
                "id", sentence.getId(),
                "listId", sentence.getSentenceList().getId(),
                "listName", sentence.getSentenceList().getName(),
                "content", sentence.getContent(),
                "createdAt", sentence.getCreatedAt(),
                "reviewCount", reviewCount
        );
    }
}
