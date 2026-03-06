package com.englishapp.service;

import com.englishapp.model.Sentence;
import com.englishapp.model.SentenceList;
import com.englishapp.model.UserAccount;
import com.englishapp.repository.SentenceListRepository;
import com.englishapp.repository.SentenceRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Service
public class ListSentenceService {
    private final SentenceListRepository sentenceListRepository;
    private final SentenceRepository sentenceRepository;
    private final ScheduleService scheduleService;

    public ListSentenceService(
            SentenceListRepository sentenceListRepository,
            SentenceRepository sentenceRepository,
            ScheduleService scheduleService
    ) {
        this.sentenceListRepository = sentenceListRepository;
        this.sentenceRepository = sentenceRepository;
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
        return sentenceRepository.findByListAndUser(listId, userId).stream()
                .map(this::sentencePayload)
                .toList();
    }

    public Map<String, Object> getSentencesPaginated(Long userId, Long listId, int page, int size) {
        getListByUser(listId, userId);
        int safeSize = Math.min(Math.max(1, size), 100);
        Pageable pageable = PageRequest.of(page, safeSize);
        var sentencePage = sentenceRepository.findByListAndUser(listId, userId, pageable);
        List<Map<String, Object>> content = sentencePage.getContent().stream()
                .map(this::sentencePayload)
                .toList();
        boolean hasMore = sentencePage.getNumber() < sentencePage.getTotalPages() - 1;
        return Map.<String, Object>of("content", content, "hasMore", hasMore);
    }

    @Transactional
    public Map<String, Object> addSentence(Long userId, Long listId, String content) {
        SentenceList list = getListByUser(listId, userId);
        Sentence sentence = new Sentence();
        sentence.setSentenceList(list);
        sentence.setContent(content);
        sentence.setCreatedAt(Instant.now());
        sentence = sentenceRepository.save(sentence);
        scheduleService.createDefaultSchedule(sentence);
        return sentencePayload(sentence);
    }

    @Transactional
    public Map<String, Object> editSentence(Long userId, Long sentenceId, String content) {
        Sentence sentence = getSentenceByUser(sentenceId, userId);
        sentence.setContent(content);
        return sentencePayload(sentence);
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
        return sentencePayload(sentence);
    }

    public Sentence getSentenceByUser(Long sentenceId, Long userId) {
        return sentenceRepository.findByIdAndUser(sentenceId, userId)
                .orElseThrow(() -> new NotFoundException("Sentence not found"));
    }

    private SentenceList getListByUser(Long listId, Long userId) {
        return sentenceListRepository.findByIdAndUserId(listId, userId)
                .orElseThrow(() -> new NotFoundException("List not found"));
    }

    public Map<String, Object> sentencePayload(Sentence sentence) {
        return Map.<String, Object>of(
                "id", sentence.getId(),
                "listId", sentence.getSentenceList().getId(),
                "content", sentence.getContent(),
                "createdAt", sentence.getCreatedAt()
        );
    }
}
