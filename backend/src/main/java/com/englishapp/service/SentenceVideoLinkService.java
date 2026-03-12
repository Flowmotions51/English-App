package com.englishapp.service;

import com.englishapp.model.Sentence;
import com.englishapp.model.SentenceVideoLink;
import com.englishapp.repository.SentenceVideoLinkRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class SentenceVideoLinkService {
    private final SentenceVideoLinkRepository sentenceVideoLinkRepository;
    private final ListSentenceService listSentenceService;

    public SentenceVideoLinkService(
            SentenceVideoLinkRepository sentenceVideoLinkRepository,
            ListSentenceService listSentenceService
    ) {
        this.sentenceVideoLinkRepository = sentenceVideoLinkRepository;
        this.listSentenceService = listSentenceService;
    }

    public List<Map<String, Object>> getVideoLinks(Long userId, Long sentenceId) {
        listSentenceService.getSentenceByUser(sentenceId, userId);
        return sentenceVideoLinkRepository.findBySentenceIdAndUserId(sentenceId, userId).stream()
                .map(this::toPayload)
                .collect(Collectors.toList());
    }

    @Transactional
    public Map<String, Object> addVideoLink(Long userId, Long sentenceId, String url, Integer timeCodeSeconds, String label) {
        Sentence sentence = listSentenceService.getSentenceByUser(sentenceId, userId);
        SentenceVideoLink link = new SentenceVideoLink();
        link.setSentence(sentence);
        link.setUrl(url == null ? "" : url.trim());
        link.setTimeCodeSeconds(timeCodeSeconds);
        link.setLabel(label != null && !label.isBlank() ? label.trim() : null);
        link = sentenceVideoLinkRepository.save(link);
        return toPayload(link);
    }

    @Transactional
    public void deleteVideoLink(Long userId, Long linkId) {
        SentenceVideoLink link = sentenceVideoLinkRepository.findByIdAndUserId(linkId, userId)
                .orElseThrow(() -> new NotFoundException("Video link not found"));
        sentenceVideoLinkRepository.delete(link);
    }

    private Map<String, Object> toPayload(SentenceVideoLink link) {
        return Map.<String, Object>of(
                "id", link.getId(),
                "url", link.getUrl(),
                "timeCodeSeconds", link.getTimeCodeSeconds(),
                "label", link.getLabel() != null ? link.getLabel() : "",
                "createdAt", link.getCreatedAt()
        );
    }
}
